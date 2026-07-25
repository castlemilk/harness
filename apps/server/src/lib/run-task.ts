import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import { runAgentTask, runOrchestratedTask, runExternalAgentTask, type ExternalCli } from '@omega/agent';
import type { PrismaClient } from '@omega/db';
import type { ProviderConfig as CoreProviderConfig, Task } from '@omega/core';
import { queue } from './task-queue.js';
import { notifyFailure } from './webhook-alerts.js';
import { getNextStrategy, executeRetry, type RetryContext, type RetryRecord } from './retry-strategies.js';
import { getRouter, recordTaskOutcome } from './intelligent-router.js';

async function tryAutoRetry(
  prisma: PrismaClient,
  taskId: string,
): Promise<void> {
  if (process.env.OMEGA_AUTO_RETRY !== 'true') return;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task || task.status !== 'failed') return;

  const tags: string[] = task.tags ? (JSON.parse(task.tags) as string[]) : [];
  const retryHistory = task.retryHistory ? (JSON.parse(task.retryHistory) as RetryRecord[]) : [];
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
    projectPath: task.project.path,
    projectName: task.project.name,
    error: task.error ?? '',
  };

  const attempt = getNextStrategy(ctx);
  if (!attempt) return;

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null },
  });

  void executeRetry(prisma, taskId, attempt, {
    projectPath: task.project.path,
    projectName: task.project.name,
    autoPublish: tags.includes('publish'),
  });
}

function toCoreConfig(row: {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKey: string | null;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}): CoreProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CoreProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as CoreProviderConfig['capabilities'],
    enabled: row.enabled,
  };
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

  const tags: string[] = task.tags ? (JSON.parse(task.tags) as string[]) : [];

  // Tasks tagged external:<cli> are driven by an external coding-agent CLI
  // (Codex, Claude Code, Gemini CLI, OpenCode, Cursor CLI, Aider).
  const externalTag = tags.find((t) => t.startsWith('external:'));
  if (externalTag) {
    const cli = externalTag.split(':')[1] as ExternalCli;
    const run = () =>
      runExternalAgentTask(prisma, taskId, {
        projectPath: task.project.path,
        projectName: task.project.name,
        autoPublish: tags.includes('publish'),
        cli,
        complexity: task.complexity,
      });
    if (options.detached) {
      const result = queue.enqueue(taskId, cli, async () => {
        try {
          await run();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Detached external agent task ${taskId} failed:`, message);
          void notifyFailure(prisma, {
            taskId, title: task.title, provider: cli, error: message, tags,
            timestamp: new Date().toISOString(),
          });
          void tryAutoRetry(prisma, taskId);
        }
      });
      return { status: 'in_progress', taskId, ...result };
    }
    return run();
  }

  if (tags.includes('agent') || tags.includes('self-improve') || tags.includes('orchestrate')) {
    const tokenBudget = options.tokenBudget ?? (process.env.OMEGA_TOKEN_BUDGET
      ? Number(process.env.OMEGA_TOKEN_BUDGET)
      : undefined);

    // Use intelligent router to pick the model, then pin it on the task row
    // so the executor's selectProvider honors the assignment.
    if (!task.provider || !task.model) {
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
          tags: task.tags ? (JSON.parse(task.tags) as Task['tags']) : [],
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

    // Tasks tagged 'orchestrate' go through the multi-agent orchestrator
    // (high-tier planner/reviewer + smaller sub-agent models); the
    // orchestrator runs its sub-agents non-isolated in the project path.
    const orchestrate = tags.includes('orchestrate');
    const router = await getRouter(prisma);
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
            intelligentRouter: router,
          })
        : runAgentTask(prisma, taskId, {
            projectPath: task.project.path,
            projectName: task.project.name,
            autoPublish: tags.includes('publish'),
            isolated: true,
            tokenBudget,
            complexity: task.complexity,
          });

    if (options.detached) {
      const result = queue.enqueue(taskId, undefined, async () => {
        try {
          await run();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Detached agent task ${taskId} failed:`, message);
          void notifyFailure(prisma, {
            taskId, title: task.title, error: message, tags,
            timestamp: new Date().toISOString(),
          });
          void tryAutoRetry(prisma, taskId);
        }
      });
      return { status: 'in_progress', taskId, ...result };
    }
    const agentResult = await run();
    return 'task' in agentResult ? agentResult.task : prisma.task.findUnique({ where: { id: taskId } });
  }

  const configs = await prisma.providerConfig.findMany();
  const coreConfigs = configs.map(toCoreConfig);

  const taskForRouter: Task = {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description ?? undefined,
    status: task.status as Task['status'],
    complexity: task.complexity as Task['complexity'],
    tags: task.tags ? (JSON.parse(task.tags) as Task['tags']) : [],
    assignedModel:
      task.provider && task.model ? { provider: task.provider, model: task.model } : undefined,
    result: task.result ?? undefined,
    error: task.error ?? undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  // Use the intelligent router with fallback cascade
  const router = await getRouter(prisma);
  const decision = router.route(coreConfigs, taskForRouter, {
    strategy: 'balanced',
    maxCandidates: 3,
  });

  if (!decision) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: 'No provider available for this task' },
    });
    return { status: 'failed', error: 'No provider available' };
  }

  // Try primary, then fallbacks in order
  const candidates = [decision.primary, ...decision.fallbacks];
  let lastError = '';

  for (const candidate of candidates) {
    const config = candidate.provider;
    const providerName = config.name;
    const modelName = candidate.model;
    const provider = createProvider(config);
    const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
    const startMs = Date.now();

    try {
      const result = await provider.send(prompt, { model: modelName });
      const durationMs = Date.now() - startMs;

      // Record success
      recordTaskOutcome(router, `${providerName}/${modelName}`, true, 0, durationMs, durationMs, true, false);

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
      const isRateLimited = message.includes('429') || message.includes('rate') || message.includes('Too Many');
      const isTimeout = message.includes('timeout') || message.includes('TIMEOUT');

      // Record failure
      recordTaskOutcome(router, `${providerName}/${modelName}`, false, 0, durationMs, durationMs, false, isRateLimited);

      lastError = message;

      // If rate-limited or timed out, try next candidate
      if (isRateLimited || isTimeout) {
        continue;
      }

      // For other errors, also try next candidate but log the failure
      if (candidates.length > 1) {
        continue;
      }
    }
  }

  // All candidates failed
  void notifyFailure(prisma, {
    taskId, title: task.title, provider: candidates[0]!.provider.name,
    model: candidates[0]!.model, error: lastError, tags,
    timestamp: new Date().toISOString(),
  });
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error: lastError,
      provider: candidates[0]!.provider.name,
      model: candidates[0]!.model,
    },
  });
  void tryAutoRetry(prisma, taskId);
  return updated;
}
