import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { asyncHandler } from '../lib/async-handler.js';

export function costRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/summary', asyncHandler(async (_req, res) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const runs = await prisma.agentRun.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: {
        costUsd: true,
        totalTokens: true,
        createdAt: true,
        resultStatus: true,
        task: { select: { provider: true, model: true } },
      },
    });

    const totalCostUsd = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const totalTokens = runs.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
    const runsWithCost = runs.filter((r) => r.costUsd != null).length;
    const completedRuns = runs.filter((r) => r.resultStatus !== 'running');
    const avgCostPerRun = completedRuns.length > 0
      ? totalCostUsd / completedRuns.length
      : 0;
    const avgTokensPerRun = completedRuns.length > 0
      ? totalTokens / completedRuns.length
      : 0;

    const costByProvider: Record<string, number> = {};
    const costByModel: Record<string, number> = {};
    const costByDay: Record<string, number> = {};

    for (const run of runs) {
      const provider = run.task.provider ?? 'unknown';
      const model = run.task.model ?? 'unknown';
      const cost = run.costUsd ?? 0;
      costByProvider[provider] = (costByProvider[provider] ?? 0) + cost;
      costByModel[model] = (costByModel[model] ?? 0) + cost;
      const day = run.createdAt.toISOString().slice(0, 10);
      costByDay[day] = (costByDay[day] ?? 0) + cost;
    }

    res.json({
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      costByProvider,
      costByModel,
      costByDay,
      totalTokens,
      avgCostPerRun: Math.round(avgCostPerRun * 1_000_000) / 1_000_000,
      avgTokensPerRun: Math.round(avgTokensPerRun),
      runsWithCost,
    });
  }));

  r.get('/timeseries', asyncHandler(async (req, res) => {
    const bucket = typeof req.query.bucket === 'string' && ['hour', 'day', 'week'].includes(req.query.bucket)
      ? req.query.bucket as 'hour' | 'day' | 'week'
      : 'day';
    const days = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : 30;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const runs = await prisma.agentRun.findMany({
      where: { createdAt: { gte: since } },
      select: {
        costUsd: true,
        totalTokens: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const bucketed: Record<string, { costUsd: number; tokens: number; runs: number; durationMs: number }> = {};

    for (const run of runs) {
      const key = truncateToBucket(run.createdAt, bucket);
      const entry = bucketed[key] ?? { costUsd: 0, tokens: 0, runs: 0, durationMs: 0 };
      entry.costUsd += run.costUsd ?? 0;
      entry.tokens += run.totalTokens ?? 0;
      entry.runs += 1;
      entry.durationMs += run.updatedAt.getTime() - run.createdAt.getTime();
      bucketed[key] = entry;
    }

    const series = Object.entries(bucketed).map(([bucket, data]) => ({
      bucket,
      costUsd: Math.round(data.costUsd * 1_000_000) / 1_000_000,
      tokens: data.tokens,
      runs: data.runs,
      avgDurationMs: Math.round(data.durationMs / data.runs),
    }));

    res.json(series);
  }));

  return r;
}

function truncateToBucket(date: Date, bucket: 'hour' | 'day' | 'week'): string {
  const d = new Date(date);
  if (bucket === 'hour') {
    d.setMinutes(0, 0, 0);
  } else if (bucket === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (bucket === 'week') {
    const dayOfWeek = d.getDay();
    d.setDate(d.getDate() - dayOfWeek);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}
