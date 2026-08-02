import type { PrismaClient } from '@omega/db';
import { runAgentTask, runExternalAgentTask, type ExternalCli } from '@omega/agent';
import { notifyFailure } from './webhook-alerts.js';
import { envInt, safeJsonParse } from './utils.js';

export interface RetryStrategy {
  name: string;
  description: string;
  apply: (ctx: RetryContext) => RetryAttempt | undefined | Promise<RetryAttempt | undefined>;
}

export interface RetryContext {
  task: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    complexity: string;
    tags: string[];
    provider: string | null;
    model: string | null;
    retryCount: number;
    retryHistory: RetryRecord[];
  };
  projectPath: string;
  projectName: string;
  error: string;
  prisma?: PrismaClient;
}

export interface RetryAttempt {
  strategy: string;
  provider?: string;
  model?: string;
  effort?: string;
  cli?: ExternalCli;
  tokenBudget?: number;
}

export interface RetryRecord {
  strategy: string;
  provider?: string;
  model?: string;
  error: string;
  timestamp: string;
}

const MAX_RETRIES = envInt('OMEGA_MAX_RETRIES', 3);

async function nextInternalTier(
  prisma: PrismaClient,
  ctx: RetryContext,
): Promise<{ provider: string; model: string } | null> {
  if (!ctx.task.provider || !ctx.task.model) return null;
  const provider = await prisma.providerConfig.findFirst({
    where: { kind: ctx.task.provider },
  });
  if (!provider) return null;
  const caps = provider.capabilities as { modelTiers?: Record<string, string> } | null;
  const ladder = caps?.modelTiers;
  if (ladder && ladder[ctx.task.model]) {
    const nextModel = ladder[ctx.task.model];
    if (nextModel) return { provider: ctx.task.provider, model: nextModel };
  }
  return null;
}

async function pickDifferentProvider(
  prisma: PrismaClient,
  current: string | null,
): Promise<{ provider: string; model: string } | null> {
  const candidates = await prisma.providerConfig.findMany({
    where: {
      enabled: true,
      ...(current ? { kind: { not: current } } : {}),
    },
    take: 5,
  });
  if (candidates.length === 0) return null;
  const pick = candidates[0];
  if (!pick) return null;
  return { provider: pick.kind, model: pick.defaultModel };
}

const RETRY_STRATEGIES: RetryStrategy[] = [
  {
    name: 'clean-retry',
    description: 'Same config, clean retry (transient error recovery)',
    apply: (ctx) => {
      if (ctx.task.retryCount > 0) return undefined;
      return {
        strategy: 'clean-retry',
        provider: ctx.task.provider ?? undefined,
        model: ctx.task.model ?? undefined,
      };
    },
  },
  {
    name: 'tier-escalation',
    description: 'Escalate to a higher model tier (internal tasks only)',
    apply: async (ctx) => {
      if (ctx.task.retryCount > 1) return undefined;
      const tags = ctx.task.tags;
      if (tags.find((t) => t.startsWith('external:'))) return undefined;
      if (tags.includes('orchestrate')) return undefined;
      const next = await nextInternalTier(ctx.prisma!, ctx);
      if (!next) return undefined;
      return { strategy: 'tier-escalation', provider: next.provider, model: next.model };
    },
  },
  {
    name: 'different-provider',
    description: 'Swap to a different provider (internal tasks only)',
    apply: async (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      if (tags.find((t) => t.startsWith('external:'))) return undefined;
      if (tags.includes('orchestrate')) return undefined;
      const next = await pickDifferentProvider(ctx.prisma!, ctx.task.provider);
      if (!next) return undefined;
      return { strategy: 'different-provider', provider: next.provider, model: next.model };
    },
  },
  {
    name: 'orchestrated-fallback',
    description: 'Fall back to orchestrated multi-agent mode',
    apply: (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      if (tags.includes('orchestrate')) return undefined;
      const externalTag = tags.find((t) => t.startsWith('external:'));
      if (externalTag) return undefined;
      return {
        strategy: 'orchestrated-fallback',
      };
    },
  },
  {
    name: 'different-cli',
    description: 'Try a different external CLI',
    apply: (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      const externalTag = tags.find((t) => t.startsWith('external:'));
      if (!externalTag) return undefined;
      const currentCli = externalTag.split(':')[1];
      const cliRotation: Record<string, string[]> = {
        'agy': ['claude-code', 'opencode'],
        'claude-code': ['agy', 'opencode'],
        'opencode': ['agy', 'claude-code'],
        'codex': ['agy', 'claude-code'],
      };
      const alternatives = cliRotation[currentCli] ?? ['agy'];
      const nextCli = alternatives[ctx.task.retryCount % alternatives.length];
      return {
        strategy: 'different-cli',
        cli: nextCli as ExternalCli,
      };
    },
  },
];

export const STRATEGIES_BY_NAME: Record<string, RetryStrategy> = Object.fromEntries(
  RETRY_STRATEGIES.map((s) => [s.name, s]),
);

export async function getNextStrategy(ctx: RetryContext): Promise<RetryAttempt | undefined> {
  if (ctx.task.retryCount >= MAX_RETRIES) return undefined;
  for (const strategy of RETRY_STRATEGIES) {
    const attempt = await strategy.apply(ctx);
    if (attempt) return attempt;
  }
  return undefined;
}

export async function executeRetry(
  prisma: PrismaClient,
  taskId: string,
  attempt: RetryAttempt,
  options: { projectPath: string; projectName: string; autoPublish: boolean },
): Promise<void> {
  // 1. Pre-run task row update: persist the active provider/model on the task row.
  //    This is the path that executor.ts / orchestrator.ts already honor via
  //    task.assignedModel (a { provider, model } record).
  const taskUpdate: Record<string, unknown> = {};
  if (attempt.provider) taskUpdate.provider = attempt.provider;
  if (attempt.model) taskUpdate.model = attempt.model;
  if (Object.keys(taskUpdate).length > 0) {
    await prisma.task.update({ where: { id: taskId }, data: taskUpdate });
  }

  // 2. Pre-run audit: append to retryHistory BEFORE the run so successful retries leave a record.
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (task) {
    const existing = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
    const record: RetryRecord = {
      strategy: attempt.strategy,
      provider: attempt.provider,
      model: attempt.model,
      error: '', // populated on failure below
      timestamp: new Date().toISOString(),
    };
    existing.push(record);
    await prisma.task.update({
      where: { id: taskId },
      data: { retryHistory: JSON.stringify(existing) },
    });
  }

  // Hoist the intelligent router for health-aware provider selection (used in two branches below).
  const { getRouter } = await import('./intelligent-router.js');
  const router = await getRouter(prisma);

  // 3. Run the retry.
  try {
    if (attempt.cli) {
      await runExternalAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        cli: attempt.cli,
        model: attempt.model,    // NEW: pass attempt.model
        effort: attempt.effort,  // NEW: pass attempt.effort
      });
    } else if (attempt.strategy === 'orchestrated-fallback') {
      const { runOrchestratedTask } = await import('@omega/agent');
      await runOrchestratedTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
        intelligentRouter: router,
      });
    } else {
      // internal task — task row already updated with provider/model; the runner honors it.
      await runAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
      }, router);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const provider = attempt.provider ?? attempt.cli ?? undefined;
    void notifyFailure(prisma, {
      taskId,
      title: task?.title ?? '',
      provider,
      model: attempt.model ?? undefined,
      error: message,
      tags: ['retry', attempt.strategy],
      timestamp: new Date().toISOString(),
    });
  }

  // 4. After the run: keep the existing retryCount + lastRetryAt + retryHistory update behavior.
  const after = await prisma.task.findUnique({ where: { id: taskId } });
  if (!after) return;
  const existing = safeJsonParse<RetryRecord[]>(after.retryHistory, []);
  // Update the latest record with the actual error if any
  const lastRecord = existing[existing.length - 1];
  if (lastRecord && lastRecord.error === '') {
    lastRecord.error = after.error ?? '';
  }
  const isStillFailed = after.status === 'failed' || after.status === 'in_progress';
  await prisma.task.update({
    where: { id: taskId },
    data: {
      retryCount: isStillFailed ? { increment: 1 } : undefined,
      lastRetryAt: new Date(),
      retryHistory: JSON.stringify(existing),
    },
  });

  console.log('Retry executed', {
    taskId,
    strategy: attempt.strategy,
    retryCount: after.retryCount + 1,
    error: after.error || undefined,
  });
}
