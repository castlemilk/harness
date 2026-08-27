import { createProvider } from '@omega/providers';
import { runAgentTask, runOrchestratedTask, type ExternalCli } from '@omega/agent';
import type { PrismaClient } from '@omega/db';
import type { Task } from '@omega/core';
import { queue } from './task-queue.js';
import { notifyFailure } from './webhook-alerts.js';
import {
  appendRetryRecord,
  classifyRetryFailure,
  executeRetry,
  getNextStrategy,
  type RetryContext,
  type RetryRecord,
} from './retry-strategies.js';
import { getRouter, recordTaskOutcome } from './intelligent-router.js';
import { startTrace, traceEvent, completeTrace } from './trace-log.js';
import { toCoreConfig, isRateLimitError, isTimeoutError, isCredentialError, safeJsonParse } from './utils.js';
import { runRoutedExternalAgentTask } from './external-agent-runner.js';

function firstNonEmpty(...values: (string | null | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

async function tryAutoRetry(
  prisma: PrismaClient,
  taskId: string,
): Promise<void> {
  if ((process.env.OMEGA_AUTO_RETRY ?? 'true').toLowerCase() === 'false') return;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (task?.status !== 'failed') return;

  const failure = firstNonEmpty(task.error, task.result) ?? '';
  const classification = classifyRetryFailure(failure);
  if (classification.classification === 'terminal') {
    await appendRetryRecord(prisma, taskId, {
      strategy: 'auto-retry-skipped',
      provider: task.provider ?? undefined,
      model: task.model ?? undefined,
      error: failure,
      triggerError: failure,
      timestamp: new Date().toISOString(),
      classification: classification.classification,
      category: classification.category,
      decision: 'skipped',
      reason: classification.reason,
    });
    console.info('Automatic retry skipped', {
      taskId,
      classification: classification.classification,
      category: classification.category,
      reason: classification.reason,
    });
    return;
  }

  const tags = safeJsonParse<string[]>(task.tags, []);
  const retryHistory = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
  const ctx: RetryContext = {
    task: {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      complexity: task.complexity,
      tags,
      provider: task.provider,
      model: task.model,
      retryCount: task.retryCount,
      retryHistory,
    },
    prisma,
    projectPath: task.project.path,
    projectName: task.project.name,
    error: failure,
  };

  const attempt = await getNextStrategy(ctx);
  if (!attempt) {
    await appendRetryRecord(prisma, taskId, {
      strategy: 'auto-retry-unavailable',
      provider: task.provider ?? undefined,
      model: task.model ?? undefined,
      error: failure,
      triggerError: failure,
      timestamp: new Date().toISOString(),
      classification: classification.classification,
      category: classification.category,
      decision: 'skipped',
      reason: 'The failure was transient, but the retry policy had no remaining strategy.',
    });
    return;
  }

  attempt.classification = classification.classification;
  attempt.category = classification.category;
  attempt.triggerError = failure;

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null },
  });

  void executeRetry(prisma, taskId, attempt, {
    projectPath: task.project.path,
    projectName: task.project.name,
    autoPublish: tags.includes('publish'),
  }).catch(console.error);
}

async function ensureFailedTaskReason(
  prisma: PrismaClient,
  taskId: string,
  fallback: string,
): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, error: true, result: true },
  });
  const reason = firstNonEmpty(task?.error, task?.result, fallback)
    ?? `Task ${taskId} failed without a reported reason.`;
  if (
    task
    && task.status !== 'done'
    && (
      task.status !== 'failed'
      || firstNonEmpty(task.error) === undefined
      || firstNonEmpty(task.result) === undefined
    )
  ) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: reason,
        result: firstNonEmpty(task.result) ?? reason,
      },
    });
  }
  return reason;
}

function inferDomain(task: { title: string; tags?: string | null }): 'code' | 'data' | 'reasoning' | 'creative' | 'general' {
  const text = `${task.title} ${task.tags ?? ''}`.toLowerCase();
  if (text.includes('test') || text.includes('fix') || text.includes('bug') || text.includes('refactor') || text.includes('implement') || text.includes('code') || text.includes('feature')) return 'code';
  if (text.includes('data') || text.includes('csv') || text.includes('json') || text.includes('sql')) return 'data';
  if (text.includes('reason') || text.includes('logic') || text.includes('proof') || text.includes('math')) return 'reasoning';
  if (text.includes('write') || text.includes('story') || text.includes('creative') || text.includes('design')) return 'creative';
  return 'general';
}

export async function runTask(
  prisma: PrismaClient,
  taskId: string,
  options: {
    detached?: boolean;
    tokenBudget?: number;
    maxSubtasks?: number;
    maxIterations?: number;
    concurrency?: number;
    /** Total wall-clock cap for one internal or external agent attempt. */
    timeoutMs?: number;
    /** Cancel the active agent attempt (for example, when a benchmark run is cancelled). */
    signal?: AbortSignal;
  } = {}
) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task) throw new Error('Task not found');

  if (task.status === 'in_progress') {
    throw new Error(`Task ${taskId} is already in progress`);
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const tags = safeJsonParse<string[]>(task.tags, []);

  // Tasks tagged external:<cli> are driven by an external coding-agent CLI
  // (Codex, Claude Code, Gemini CLI, OpenCode, Cursor CLI, Aider).
  const VALID_CLIS: ExternalCli[] = ['agy', 'claude-code', 'opencode', 'codex', 'gemini-cli', 'aider', 'cursor-cli'];
  const externalTag = tags.find((t) => t.startsWith('external:'));
  if (externalTag) {
    const cli = externalTag.split(':')[1] as ExternalCli;
    if (!VALID_CLIS.includes(cli)) {
      const reason = `Invalid external CLI: ${cli}. Allowed: ${VALID_CLIS.join(', ')}`;
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'failed', error: reason, result: reason },
      });
      // No retry before rethrowing: the caller is about to receive a failure,
      // and a blocking chain here could mark the task done while still throwing.
      throw new Error(reason);
    }
    let model = task.model ?? process.env.CODEX_MODEL;
    let effort = process.env.CODEX_EFFORT;
    if (cli === 'codex') {
      const modelTag = tags.find((tag) => tag.startsWith('codex-model:'));
      const effortTag = tags.find((tag) => tag.startsWith('codex-effort:'));
      model = modelTag?.slice('codex-model:'.length) ?? model;
      effort = effortTag?.slice('codex-effort:'.length) ?? effort;

      if (model) {
        await prisma.task.update({
          where: { id: taskId },
          data: { model },
        });
      }
    }
    const run = () =>
      runRoutedExternalAgentTask(prisma, taskId, {
        projectPath: task.project.path,
        projectName: task.project.name,
        autoPublish: tags.includes('publish'),
        cli,
        complexity: task.complexity,
        model,
        effort,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
    if (options.detached) {
      const result = queue.enqueue(taskId, cli, async () => {
        try {
          const externalResult = await run();
          if (externalResult.status === 'failed') {
            const reason = await ensureFailedTaskReason(
              prisma,
              taskId,
              firstNonEmpty(externalResult.output) ?? `External CLI ${cli} returned failed.`,
            );
            console.error(`Detached external agent task ${taskId} failed:`, reason);
            if (!options.signal?.aborted) {
              void notifyFailure(prisma, {
                taskId, title: task.title, provider: `external:${cli}`, model, error: reason, tags,
                timestamp: new Date().toISOString(),
              }).catch(console.error);
            }
            // Detached: the caller already returned, so a blocking retry chain
            // would hold this queue slot for up to four sequential runs.
            if (!options.signal?.aborted) {
              void tryAutoRetry(prisma, taskId).catch(console.error);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const reason = await ensureFailedTaskReason(prisma, taskId, message);
          console.error(`Detached external agent task ${taskId} failed:`, message);
          if (!options.signal?.aborted) {
            void notifyFailure(prisma, {
              taskId, title: task.title, provider: `external:${cli}`, model, error: reason, tags,
              timestamp: new Date().toISOString(),
            }).catch(console.error);
          }
          // Detached: the caller already returned, so a blocking retry chain
          // would hold this queue slot for up to four sequential runs.
          if (!options.signal?.aborted) {
            void tryAutoRetry(prisma, taskId).catch(console.error);
          }
        }
      });
      return { status: 'in_progress', taskId, ...result };
    }
    const externalResult = await run();
    if (externalResult.status === 'failed') {
      const reason = await ensureFailedTaskReason(
        prisma,
        taskId,
        firstNonEmpty(externalResult.output) ?? `External CLI ${cli} returned failed.`,
      );
      if (!options.signal?.aborted) {
        void notifyFailure(prisma, {
          taskId, title: task.title, provider: `external:${cli}`, model, error: reason, tags,
          timestamp: new Date().toISOString(),
        }).catch(console.error);
      }
      if (!options.signal?.aborted) {
        await tryAutoRetry(prisma, taskId);
      }
    }
    return externalResult;
  }

  if (tags.includes('agent') || tags.includes('self-improve') || tags.includes('orchestrate')) {
    const trace = startTrace(taskId);
    const tokenBudget = options.tokenBudget ?? (process.env.OMEGA_TOKEN_BUDGET
      ? Number(process.env.OMEGA_TOKEN_BUDGET)
      : undefined);
    const orchestrate = tags.includes('orchestrate');

    // Normal agent tasks need a provider pinned before the executor starts.
    // Orchestrated tasks select the planner and each sub-agent independently
    // by tier, so pre-pinning the parent would collapse all tiers to one model.
    if (!orchestrate && (!task.provider || !task.model)) {
      try {
        const configs = await prisma.providerConfig.findMany();
        const coreConfigs = configs.map(toCoreConfig);
        const router = await getRouter(prisma);
        const taskForRouter: Task = {
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          description: task.description ?? undefined,
          status: task.status as Task['status'],
          complexity: task.complexity as Task['complexity'],
          tags: safeJsonParse<string[]>(task.tags, []),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
        const decision = router.route(coreConfigs, taskForRouter, {
          strategy: 'balanced',
          maxCandidates: 1,
        });
        if (decision) {
          await prisma.task.update({
            where: { id: taskId },
            data: { provider: decision.primary.provider.name, model: decision.primary.model },
          });
        }
      } catch {
        // Fallback: let executor use its own routing
      }
    }

    traceEvent(trace, 'route.start', { strategy: 'balanced' });

    // Tasks tagged 'orchestrate' go through the multi-agent orchestrator
    // (high-tier planner/reviewer + smaller sub-agent models); the
    // orchestrator runs its sub-agents non-isolated in the project path.
    let router: Awaited<ReturnType<typeof getRouter>>;
    try {
      router = await getRouter(prisma);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = await ensureFailedTaskReason(
        prisma,
        taskId,
        `Internal agent setup failed before its first model turn: ${firstNonEmpty(message) ?? 'router unavailable'}`,
      );
      // No retry before rethrowing: the caller is about to receive a failure,
      // and a blocking chain here could mark the task done while still throwing.
      throw new Error(reason, { cause: err });
    }
    const run = () =>
      orchestrate
        ? runOrchestratedTask(prisma, taskId, {
            projectPath: task.project.path,
            projectName: task.project.name,
            autoPublish: tags.includes('publish'),
            tokenBudget,
            maxSubtasks: options.maxSubtasks,
            maxIterations: options.maxIterations,
            concurrency: options.concurrency,
            complexity: task.complexity,
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            intelligentRouter: router,
          })
        : runAgentTask(prisma, taskId, {
            projectPath: task.project.path,
            projectName: task.project.name,
            autoPublish: tags.includes('publish'),
            isolated: true,
            tokenBudget,
            complexity: task.complexity,
            timeoutMs: options.timeoutMs,
            signal: options.signal,
          }, router);

    if (options.detached) {
      const result = queue.enqueue(taskId, undefined, async () => {
        try {
          const agentResult = await run();
          const finalTask = 'task' in agentResult
            ? agentResult.task
            : await prisma.task.findUnique({ where: { id: taskId } });
          traceEvent(trace, 'route.selected', { provider: task.provider ?? undefined, model: task.model ?? undefined });
          if (finalTask?.status === 'failed') {
            const reason = await ensureFailedTaskReason(
              prisma,
              taskId,
              finalTask.error ?? finalTask.result ?? 'Internal agent returned failed without a reason.',
            );
            traceEvent(trace, 'llm.error', { error: reason });
            completeTrace(trace, 'error', task.provider ?? undefined, task.model ?? undefined);
            if (!options.signal?.aborted) {
              void notifyFailure(prisma, {
                taskId, title: task.title, provider: task.provider ?? undefined,
                model: task.model ?? undefined, error: reason, tags,
                timestamp: new Date().toISOString(),
              }).catch(console.error);
            }
            // Detached: the caller already returned, so a blocking retry chain
            // would hold this queue slot for up to four sequential runs.
            if (!options.signal?.aborted) {
              void tryAutoRetry(prisma, taskId).catch(console.error);
            }
          } else {
            completeTrace(trace, 'success', task.provider ?? undefined, task.model ?? undefined);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const reason = await ensureFailedTaskReason(prisma, taskId, message);
          traceEvent(trace, 'llm.error', { error: reason });
          completeTrace(trace, 'error');
          console.error(`Detached agent task ${taskId} failed:`, reason);
          if (!options.signal?.aborted) {
            void notifyFailure(prisma, {
              taskId, title: task.title, error: reason, tags,
              timestamp: new Date().toISOString(),
            }).catch(console.error);
          }
          // Detached: the caller already returned, so a blocking retry chain
          // would hold this queue slot for up to four sequential runs.
          if (!options.signal?.aborted) {
            void tryAutoRetry(prisma, taskId).catch(console.error);
          }
        }
      });
      return { status: 'in_progress', taskId, ...result };
    }
    try {
      const agentResult = await run();
      traceEvent(trace, 'route.selected', { provider: task.provider ?? undefined, model: task.model ?? undefined });
      // Record health/performance for the intelligent router after agent completion
      const finalTask = 'task' in agentResult ? agentResult.task : await prisma.task.findUnique({ where: { id: taskId } });
      if (finalTask && !options.signal?.aborted) {
        const provider = (finalTask as Record<string, unknown>).provider as string | undefined;
        const model = (finalTask as Record<string, unknown>).model as string | undefined;
        if (provider && model) {
          const router = await getRouter(prisma);
          const passed = finalTask.status === 'done';
          const costUsd = (finalTask as Record<string, unknown>).costUsd as number | undefined;
          const durationMs = finalTask.updatedAt.getTime() - finalTask.createdAt.getTime();
          recordTaskOutcome(router, `${provider}/${model}`, passed, costUsd ?? 0, durationMs, durationMs, true, false, inferDomain(task), task.complexity);
        }
      }
      if (finalTask?.status === 'failed') {
        const reason = await ensureFailedTaskReason(
          prisma,
          taskId,
          finalTask.error ?? finalTask.result ?? 'Internal agent returned failed without a reason.',
        );
        traceEvent(trace, 'llm.error', { error: reason });
        completeTrace(trace, 'error', task.provider ?? undefined, task.model ?? undefined);
        if (!options.signal?.aborted) {
          void notifyFailure(prisma, {
            taskId, title: task.title, provider: task.provider ?? undefined,
            model: task.model ?? undefined, error: reason, tags,
            timestamp: new Date().toISOString(),
          }).catch(console.error);
        }
        if (!options.signal?.aborted) {
          await tryAutoRetry(prisma, taskId);
        }
      } else {
        completeTrace(trace, 'success', task.provider ?? undefined, task.model ?? undefined);
      }
      return finalTask;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = await ensureFailedTaskReason(prisma, taskId, message);
      traceEvent(trace, 'llm.error', { error: reason });
      completeTrace(trace, 'error');
      // No retry before rethrowing: the caller is about to receive a failure,
      // and a blocking chain here could mark the task done while still throwing.
      throw err;
    }
  }

  const runGenericTask = async () => {
  const configs = await prisma.providerConfig.findMany();
  const coreConfigs = configs.map(toCoreConfig);

  const taskForRouter: Task = {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description ?? undefined,
    status: task.status as Task['status'],
    complexity: task.complexity as Task['complexity'],
    tags: safeJsonParse<string[]>(task.tags, []),
    assignedModel:
      task.provider && task.model ? { provider: task.provider, model: task.model } : undefined,
    result: task.result ?? undefined,
    error: task.error ?? undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  // Use the intelligent router with fallback cascade
  const trace = startTrace(taskId);
  const router = await getRouter(prisma);
  const decision = router.route(coreConfigs, taskForRouter, {
    strategy: 'balanced',
    maxCandidates: 3,
  });

  if (!decision) {
    traceEvent(trace, 'route.start');
    traceEvent(trace, 'route.candidates', { count: 0, reason: 'no_provider_available' });
    completeTrace(trace, 'error');
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: 'No provider available for this task',
        result: 'No provider available for this task',
      },
    });
    return { status: 'failed', error: 'No provider available' };
  }

  // Filter out circuit-broken providers to avoid wasting time on known-bad endpoints
  const allCandidates = [decision.primary, ...decision.fallbacks];
  traceEvent(trace, 'route.start', { strategy: 'balanced' });
  traceEvent(trace, 'route.candidates', {
    candidates: allCandidates.map((c) => ({
      provider: c.provider.name,
      model: c.model,
      score: c.score,
      breakdown: c.breakdown,
    })),
  });

  const candidates = allCandidates.filter((c) => {
    const broken = router.health.isCircuitBroken(c.provider.name);
    if (broken) {
      traceEvent(trace, 'circuit.open_skip', { provider: c.provider.name });
    }
    return !broken;
  });
  if (candidates.length === 0) {
    // All circuit-broken — try primary anyway as a last resort
    candidates.push(decision.primary);
  }

  // Total cascade timeout: don't spend more than 3 minutes across all fallbacks
  const CASCADE_TIMEOUT_MS = 3 * 60 * 1000;
  const cascadeStart = Date.now();
  let lastError = '';

  for (const candidate of candidates) {
    const elapsed = Date.now() - cascadeStart;
    if (elapsed > CASCADE_TIMEOUT_MS) {
      lastError = `Cascade timeout after ${String(Math.round(elapsed / 1000))}s across ${String(candidates.length)} providers`;
      traceEvent(trace, 'timeout.abort', { elapsed, cascadeTimeout: CASCADE_TIMEOUT_MS });
      break;
    }

    const config = candidate.provider;
    const providerName = config.name;
    const modelName = candidate.model;
    traceEvent(trace, 'route.selected', { provider: providerName, model: modelName, score: candidate.score, breakdown: candidate.breakdown });

    // Rate limit backpressure: if provider was recently rate-limited, wait before trying
    const recentRateLimit = router.health.getEntries().find((e) => e.provider === `${providerName}/${modelName}`);
    if (recentRateLimit && recentRateLimit.rateLimitRate > 0.5) {
      const backpressureMs = Math.min(5000, recentRateLimit.latencyP50 * 0.5);
      traceEvent(trace, 'rate_limit.backpressure', { provider: providerName, delayMs: backpressureMs });
      await new Promise((r) => setTimeout(r, backpressureMs));
    }

    const provider = createProvider(config);
    const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
    const startMs = Date.now();
    traceEvent(trace, 'llm.request', { provider: providerName, model: modelName, promptLen: prompt.length });

    // Timeout per-provider: clamp to remaining cascade budget so a single
    // provider with multiple retries cannot exceed the total 3-minute window.
    const isKimiK3 = config.kind === 'kimi' && modelName.startsWith('k3');
    const isQwen = config.kind === 'generic' && modelName.includes('qwen3.8');
    const perProviderTimeoutMs = (isKimiK3 || isQwen) ? 180_000 : 45_000;
    const remaining = CASCADE_TIMEOUT_MS - (Date.now() - cascadeStart);
    const attemptTimeoutMs = Math.min(perProviderTimeoutMs, Math.max(10_000, remaining / 2));
    const maxAttempts = Math.max(0, Math.min(3, Math.floor(remaining / attemptTimeoutMs) - 1));
    traceEvent(trace, 'cascade.budget', { provider: providerName, remainingMs: remaining, timeoutMs: attemptTimeoutMs, maxRetries: maxAttempts });
    try {
      const result = await provider.send(prompt, { model: modelName, timeoutMs: attemptTimeoutMs, maxRetries: maxAttempts });
      const durationMs = Date.now() - startMs;

      traceEvent(trace, 'llm.response', { provider: providerName, model: modelName, durationMs, resultLen: result.length });
      completeTrace(trace, 'success', providerName, modelName);

      // Record success
      recordTaskOutcome(router, `${providerName}/${modelName}`, true, 0, durationMs, durationMs, true, false, inferDomain(task), task.complexity);

      const updated = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'done',
          result,
          provider: providerName,
          model: modelName,
          error: null,
        },
      });
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startMs;
      const rateLimited = isRateLimitError(message);
      const timeout = isTimeoutError(message);
      const credential = isCredentialError(message);

      traceEvent(trace, 'llm.error', { provider: providerName, model: modelName, durationMs, isRateLimited: rateLimited, isTimeout: timeout, isCredential: credential, error: message.slice(0, 200) });

      // Record failure
      recordTaskOutcome(router, `${providerName}/${modelName}`, false, 0, durationMs, durationMs, false, rateLimited, inferDomain(task), task.complexity);

      lastError = message;

      // If rate-limited or timed out, try next candidate
      if (rateLimited || timeout) {
        continue;
      }

      // For other errors, also try next candidate but log the failure
      if (candidates.length > 1) {
        continue;
      }
    }
  }

  // All candidates failed
  const authErrors = candidates.filter((c) => {
    const entry = router.health.getEntries().find((e) => e.provider === `${c.provider.name}/${c.model}`);
    return entry && entry.errorRate > 0.8;
  });
  const outcome = authErrors.length === candidates.length ? 'auth_error' : 'error';
  completeTrace(trace, outcome, candidates[0]?.provider.name, candidates[0]?.model);
  const disclosedError = firstNonEmpty(lastError)
    ?? `All ${String(candidates.length)} routed provider candidate(s) failed without returning an error message.`;

  void notifyFailure(prisma, {
    taskId, title: task.title, provider: candidates[0].provider.name,
    model: candidates[0].model, error: disclosedError, tags,
    timestamp: new Date().toISOString(),
  }).catch(console.error);
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error: disclosedError,
      result: disclosedError,
      provider: candidates[0].provider.name,
      model: candidates[0].model,
    },
  });
  if (!options.signal?.aborted) {
    void tryAutoRetry(prisma, taskId).catch(console.error);
  }
  return updated;
  };

  if (options.detached) {
    const result = queue.enqueue(taskId, undefined, async () => {
      try {
        await runGenericTask();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ensureFailedTaskReason(prisma, taskId, message);
        console.error(`Detached generic task ${taskId} failed:`, message);
      }
    });
    return { status: 'in_progress', taskId, ...result };
  }

  return runGenericTask();
}
