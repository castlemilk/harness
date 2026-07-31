import type { PrismaClient } from '@omega/db';
import { runAgentTask, runExternalAgentTask, type ExternalCli } from '@omega/agent';
import { notifyFailure } from './webhook-alerts.js';
import { envInt, safeJsonParse } from './utils.js';

export interface RetryStrategy {
  name: string;
  description: string;
  apply: (ctx: RetryContext) => RetryAttempt | undefined;
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
}

export interface RetryAttempt {
  strategy: string;
  provider?: string;
  model?: string;
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
    description: 'Escalate to a higher model tier',
    apply: (ctx) => {
      if (ctx.task.retryCount > 1) return undefined;
      const tags = ctx.task.tags;
      const externalTag = tags.find((t) => t.startsWith('external:'));
      if (externalTag) return undefined;
      return {
        strategy: 'tier-escalation',
      };
    },
  },
  {
    name: 'different-provider',
    description: 'Try a different provider entirely',
    apply: (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      const externalTag = tags.find((t) => t.startsWith('external:'));
      if (externalTag) return undefined;
      return {
        strategy: 'different-provider',
      };
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

export function getNextStrategy(ctx: RetryContext): RetryAttempt | undefined {
  if (ctx.task.retryCount >= MAX_RETRIES) return undefined;
  for (const strategy of RETRY_STRATEGIES) {
    const attempt = strategy.apply(ctx);
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
  const record: RetryRecord = {
    strategy: attempt.strategy,
    provider: attempt.provider,
    model: attempt.model,
    error: '',
    timestamp: new Date().toISOString(),
  };

  try {
    const tags: string[] = [];
    if (attempt.cli) {
      tags.push(`external:${attempt.cli}`);
    }
    tags.push('agent', 'retry');

    // Get the intelligent router for health-aware provider selection
    const { getRouter } = await import('./intelligent-router.js');
    const router = await getRouter(prisma);

    if (attempt.cli) {
      await runExternalAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        cli: attempt.cli,
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
      await runAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
      }, router);
    }
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    void notifyFailure(prisma, {
      taskId,
      title: '',
      provider: attempt.provider ?? attempt.cli,
      model: attempt.model,
      error: record.error,
      tags: ['retry', attempt.strategy],
      timestamp: record.timestamp,
    });
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const existing = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
  existing.push(record);

  // Only increment retry count if the task is still failed
  const isStillFailed = task.status === 'failed' || task.status === 'in_progress';

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
    retryCount: task.retryCount + 1,
    error: record.error || undefined,
  });
}
