import {
  runExternalAgentTask,
  type ExternalAgentOptions,
  type ExternalAgentResult,
} from '@omega/agent';
import type { PrismaClient } from '@omega/db';
import { getRouter } from './intelligent-router.js';

export interface ExternalRouterKeys {
  /** Circuit-breaker key: exactly the identity consulted before a run. */
  healthProviderKey: string;
  /** Scoring key: the CLI identity plus its configured model. */
  performanceKey: string;
}

function externalModelIdentity(options: Pick<ExternalAgentOptions, 'cli' | 'model'>): string {
  const configured = options.model?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  return options.cli === 'opencode' ? 'opencode/big-pickle' : options.cli;
}

function externalWasRateLimited(output: string): boolean {
  return /\b429\b|rate.?limit|too many requests/i.test(output);
}

export function externalRouterKeys(options: Pick<ExternalAgentOptions, 'cli' | 'model'>): ExternalRouterKeys {
  const healthProviderKey = `external:${options.cli}`;
  const model = externalModelIdentity(options);
  return {
    healthProviderKey,
    performanceKey: `${healthProviderKey}/${model}`,
  };
}

async function discloseCircuitOpen(
  prisma: PrismaClient,
  taskId: string,
  options: ExternalAgentOptions,
  healthProviderKey: string,
): Promise<ExternalAgentResult> {
  const reason = `External CLI ${healthProviderKey} circuit is open; skipped ${options.cli} before process start.`;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error: reason,
      result: reason,
      provider: healthProviderKey,
      model: externalModelIdentity(options),
    },
  });
  try {
    await prisma.taskTrace.create({
      data: { taskId, role: 'system', content: reason },
    });
  } catch (err) {
    console.warn('[external] could not record open-circuit trace', { taskId, error: String(err) });
  }
  console.warn('[external] circuit open; run skipped', { taskId, provider: healthProviderKey });
  return { status: 'failed', diff: '', output: reason, executionSucceeded: false };
}

/**
 * Run an external CLI behind the same health/performance feedback loop as chat
 * providers. Router state is deliberately best-effort: an unavailable or
 * malformed telemetry backend must never change whether the CLI task runs.
 */
export async function runRoutedExternalAgentTask(
  prisma: PrismaClient,
  taskId: string,
  options: ExternalAgentOptions,
): Promise<ExternalAgentResult> {
  const keys = externalRouterKeys(options);
  let router: Awaited<ReturnType<typeof getRouter>> | null = null;

  try {
    router = await getRouter(prisma);
  } catch (err) {
    console.warn('[external] router unavailable; running without circuit telemetry', {
      taskId,
      error: String(err),
    });
  }

  // Do not rewrite an already-cancelled attempt as a circuit-open failure.
  if (router && !options.signal?.aborted) {
    try {
      if (router.health.isCircuitBroken(keys.healthProviderKey)) {
        return await discloseCircuitOpen(prisma, taskId, options, keys.healthProviderKey);
      }
    } catch (err) {
      console.warn('[external] circuit check failed; proceeding with CLI run', {
        taskId,
        provider: keys.healthProviderKey,
        error: String(err),
      });
    }
  }

  const startedAt = Date.now();
  let result: ExternalAgentResult;
  try {
    result = await runExternalAgentTask(prisma, taskId, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const trimmedMessage = message.trim();
    const reason = trimmedMessage.length > 0
      ? trimmedMessage
      : `External CLI ${options.cli} failed without an error message.`;
    try {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: reason,
          result: reason,
          provider: keys.healthProviderKey,
          model: externalModelIdentity(options),
        },
      });
    } catch (writeErr) {
      console.warn('[external] could not disclose unexpected CLI failure', {
        taskId,
        error: String(writeErr),
      });
    }
    result = { status: 'failed', diff: '', output: reason, executionSucceeded: false };
  }

  // Intentional caller cancellation is not a provider/CLI health outcome.
  // Recording it would poison routing decisions for subsequent benchmark tasks.
  if (router && !options.signal?.aborted) {
    const durationMs = Date.now() - startedAt;
    let costUsd = 0;
    try {
      const run = await prisma.agentRun.findFirst({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
        select: { costUsd: true },
      });
      costUsd = run?.costUsd ?? 0;
    } catch (err) {
      console.warn('[external] could not read run cost for router telemetry', {
        taskId,
        error: String(err),
      });
    }

    try {
      router.health.record(keys.healthProviderKey, {
        latencyMs: durationMs,
        success: result.executionSucceeded,
        rateLimited: externalWasRateLimited(result.output),
        costUsd,
      });
    } catch (err) {
      console.warn('[external] could not record router health outcome', {
        taskId,
        provider: keys.healthProviderKey,
        error: String(err),
      });
    }
    try {
      router.performance.update(
        keys.performanceKey,
        result.status === 'done',
        costUsd,
        durationMs,
      );
    } catch (err) {
      console.warn('[external] could not record router performance outcome', {
        taskId,
        provider: keys.performanceKey,
        error: String(err),
      });
    }
  }

  return result;
}
