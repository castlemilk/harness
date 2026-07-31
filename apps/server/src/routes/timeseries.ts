import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { asyncHandler } from '../lib/async-handler.js';
import { truncateToBucket } from '../lib/utils.js';

export function timeseriesRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/tasks', asyncHandler(async (req, res) => {
    const bucket = typeof req.query.bucket === 'string' && ['hour', 'day', 'week'].includes(req.query.bucket)
      ? req.query.bucket as 'hour' | 'day' | 'week'
      : 'day';
    const days = typeof req.query.days === 'string' ? (parseInt(req.query.days, 10) || 30) : 30;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const tasks = await prisma.task.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, createdAt: true },
    });

    const created: Record<string, number> = {};
    const completed: Record<string, number> = {};
    const failed: Record<string, number> = {};

    for (const task of tasks) {
      const key = truncateToBucket(task.createdAt, bucket);
      created[key] = (created[key] ?? 0) + 1;
      if (task.status === 'done') {
        completed[key] = (completed[key] ?? 0) + 1;
      } else if (task.status === 'failed') {
        failed[key] = (failed[key] ?? 0) + 1;
      }
    }

    const allKeys = new Set([...Object.keys(created), ...Object.keys(completed), ...Object.keys(failed)]);
    const passRate = [...allKeys].sort().map((key) => {
      const c = completed[key] ?? 0;
      const f = failed[key] ?? 0;
      return { bucket: key, rate: c + f > 0 ? Math.round((c / (c + f)) * 100) / 100 : 0 };
    });

    res.json({
      created: Object.entries(created).sort(([a], [b]) => a.localeCompare(b)).map(([bucket, count]) => ({ bucket, count })),
      completed: Object.entries(completed).sort(([a], [b]) => a.localeCompare(b)).map(([bucket, count]) => ({ bucket, count })),
      failed: Object.entries(failed).sort(([a], [b]) => a.localeCompare(b)).map(([bucket, count]) => ({ bucket, count })),
      passRate,
    });
  }));

  r.get('/providers', asyncHandler(async (req, res) => {
    const bucket = typeof req.query.bucket === 'string' && ['hour', 'day', 'week'].includes(req.query.bucket)
      ? req.query.bucket as 'hour' | 'day' | 'week'
      : 'day';
    const days = typeof req.query.days === 'string' ? (parseInt(req.query.days, 10) || 30) : 30;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const runs = await prisma.agentRun.findMany({
      where: { createdAt: { gte: since } },
      select: {
        createdAt: true,
        updatedAt: true,
        totalTokens: true,
        task: { select: { provider: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const bucketed: Record<string, Record<string, { runs: number; durationMs: number; tokens: number }>> = {};

    for (const run of runs) {
      const key = truncateToBucket(run.createdAt, bucket);
      const provider = run.task.provider ?? 'unknown';
      const bucketEntry = bucketed[key] ?? {};
      const providerEntry = bucketEntry[provider] ?? { runs: 0, durationMs: 0, tokens: 0 };
      providerEntry.runs += 1;
      providerEntry.durationMs += run.updatedAt.getTime() - run.createdAt.getTime();
      providerEntry.tokens += run.totalTokens ?? 0;
      bucketEntry[provider] = providerEntry;
      bucketed[key] = bucketEntry;
    }

    const series = Object.entries(bucketed)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([bucket, providers]) =>
        Object.entries(providers).map(([provider, data]) => ({
          bucket,
          provider,
          runs: data.runs,
          avgDurationMs: Math.round(data.durationMs / data.runs),
          totalTokens: data.tokens,
        })),
      );

    res.json(series);
  }));

  return r;
}
