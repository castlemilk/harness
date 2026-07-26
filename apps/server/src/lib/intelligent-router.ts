/**
 * Singleton IntelligentRouter instance for the server.
 * Initialized once with historical data, updated after each task.
 * Persists health + performance state across restarts.
 */

import { IntelligentRouter, saveRouterState, loadRouterState } from '@omega/router';
import type { PrismaClient } from '@omega/db';

let router: IntelligentRouter | null = null;

export async function getRouter(prisma: PrismaClient): Promise<IntelligentRouter> {
  if (router) return router;

  router = new IntelligentRouter();

  // Restore persisted state (health, performance, strategy scores)
  await loadRouterState(router);

  // Load historical performance data (last 1000 agent runs)
  try {
    const rows = await prisma.agentRun.findMany({
      take: 1000,
      orderBy: { createdAt: 'desc' },
      select: {
        resultStatus: true,
        costUsd: true,
        createdAt: true,
        updatedAt: true,
        task: { select: { provider: true, model: true } },
      },
    });
    router.performance.loadFromRows(rows.map((r) => ({
      provider: r.task.provider,
      model: r.task.model,
      resultStatus: r.resultStatus,
      costUsd: r.costUsd,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })));
  } catch {
    // Historical data not available yet — router will use capability-only scoring
  }

  // Periodically persist state (every 5 minutes)
  const persistInterval = setInterval(() => {
    void saveRouterState(router!);
  }, 5 * 60 * 1000);

  // Clean up on process exit
  process.on('SIGTERM', () => {
    clearInterval(persistInterval);
    void saveRouterState(router!);
  });

  return router;
}

/**
 * Record a task outcome for future routing decisions.
 */
export function recordTaskOutcome(
  router: IntelligentRouter,
  providerKey: string,
  passed: boolean,
  costUsd: number,
  durationMs: number,
  latencyMs: number,
  success: boolean,
  rateLimited: boolean,
  domain?: string,
  complexity?: string,
): void {
  router.performance.update(providerKey, passed, costUsd, durationMs);
  router.health.record(providerKey, { latencyMs, success, rateLimited, costUsd });
  if (domain && complexity) {
    router.strategyLearner.recordOutcome(
      domain as 'code' | 'data' | 'reasoning' | 'creative' | 'general',
      complexity as 'simple' | 'medium' | 'complex',
      'balanced',
      passed,
      costUsd,
    );
  }
}
