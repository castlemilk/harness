import type { PrismaClient } from '@omega/db';
import type { ProviderConfig as CoreProviderConfig } from '@omega/core';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import { runAgentTask, runExternalAgentTask, type ExternalCli } from '@omega/agent';
import { notifyFailure } from './webhook-alerts.js';

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

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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
  const existing = task.retryHistory ? (JSON.parse(task.retryHistory) as RetryRecord[]) : [];
  existing.push(record);
  await prisma.task.update({
    where: { id: taskId },
    data: {
      retryCount: { increment: 1 },
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
