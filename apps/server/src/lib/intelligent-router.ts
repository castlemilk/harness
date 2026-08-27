/**
 * Singleton IntelligentRouter instance for the server.
 * Initialized once with historical data, updated after each task.
 * Persists health + performance state across restarts.
 */

import { IntelligentRouter, saveRouterState, loadRouterState } from '@omega/router';
import type { PrismaClient } from '@omega/db';

let router: IntelligentRouter | null = null;
let routerPromise: Promise<IntelligentRouter> | null = null;
let persistInterval: ReturnType<typeof setInterval> | null = null;

export async function getRouter(prisma: PrismaClient): Promise<IntelligentRouter> {
  if (router) return router;
  if (routerPromise) return routerPromise;

  routerPromise = (async () => {
    const r = new IntelligentRouter();

    // Restore persisted state (health, performance, strategy scores)
    await loadRouterState(r);

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
      r.performance.loadFromRows(rows.map((row) => ({
        provider: row.task.provider,
        model: row.task.model,
        resultStatus: row.resultStatus,
        costUsd: row.costUsd,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })));
    } catch {
      // Historical data not available yet — router will use capability-only scoring
    }

    // Benchmark evidence closes the loop that was always missing: the router
    // learned only from live AgentRun outcomes, while the deliberate,
    // controlled measurements in BenchmarkHistory sat unread. Each run folds
    // in as an aggregate under the same provider/model key the scorer reads.
    try {
      const benches = await prisma.benchmarkHistory.findMany({
        take: 200,
        orderBy: { createdAt: 'desc' },
        select: {
          provider: true,
          model: true,
          totalTasks: true,
          passed: true,
          totalCostUsd: true,
          totalDurationMs: true,
          createdAt: true,
        },
      });
      for (const bench of benches) {
        if (!bench.provider || !bench.model) continue;
        r.performance.loadAggregate(`${bench.provider}/${bench.model}`, {
          passes: bench.passed,
          total: bench.totalTasks,
          costUsd: bench.totalCostUsd ?? 0,
          durationMs: bench.totalDurationMs,
          at: bench.createdAt,
        });
      }
    } catch {
      // No benchmark history yet — nothing to fold in.
    }

    router = r;

    // Periodically persist state (every 5 minutes)
    persistInterval = setInterval(() => {
      void saveRouterState(r);
    }, 5 * 60 * 1000);

    return r;
  })();

  return routerPromise;
}

/**
 * Clean up router resources (intervals, state persistence).
 * Call from the single SIGTERM handler in index.ts.
 */
export async function shutdownRouter(): Promise<void> {
  if (persistInterval) {
    clearInterval(persistInterval);
    persistInterval = null;
  }
  if (router) {
    await saveRouterState(router);
  }
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
