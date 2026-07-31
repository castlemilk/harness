import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { asyncHandler } from '../lib/async-handler.js';

export function providerCompareRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // GET /providers/compare — side-by-side provider stats
  r.get('/', asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string'
      ? new Date(req.query.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const tasks = await prisma.task.findMany({
      where: {
        status: { in: ['done', 'failed'] },
        provider: { not: null },
        model: { not: null },
        createdAt: { gte: since },
      },
      select: {
        status: true,
        provider: true,
        model: true,
        complexity: true,
        createdAt: true,
        updatedAt: true,
        error: true,
      },
    });

    // Group by provider/model
    const stats = new Map<string, {
      provider: string;
      model: string;
      total: number;
      passed: number;
      failed: number;
      avgDurationMs: number;
      errors: Record<string, number>;
      byComplexity: Record<string, { total: number; passed: number }>;
    }>();

    for (const t of tasks) {
      const key = `${t.provider ?? ''}/${t.model ?? ''}`;
      let entry = stats.get(key);
      if (!entry) {
        entry = {
          provider: t.provider ?? '',
          model: t.model ?? '',
          total: 0,
          passed: 0,
          failed: 0,
          avgDurationMs: 0,
          errors: {},
          byComplexity: {},
        };
        stats.set(key, entry);
      }
      entry.total++;
      if (t.status === 'done') entry.passed++;
      else entry.failed++;

      const duration = t.updatedAt.getTime() - t.createdAt.getTime();
      entry.avgDurationMs = (entry.avgDurationMs * (entry.total - 1) + duration) / entry.total;

      if (t.error) {
        const key = t.error.slice(0, 60);
        entry.errors[key] = (entry.errors[key] ?? 0) + 1;
      }

      if (!(t.complexity in entry.byComplexity)) entry.byComplexity[t.complexity] = { total: 0, passed: 0 };
      entry.byComplexity[t.complexity].total++;
      if (t.status === 'done') entry.byComplexity[t.complexity].passed++;
    }

    const results = [...stats.values()]
      .map((s) => ({
        ...s,
        passRate: s.total > 0 ? Number((s.passed / s.total).toFixed(2)) : 0,
        avgDurationMs: Math.round(s.avgDurationMs),
        topErrors: Object.entries(s.errors)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([error, count]) => ({ error, count })),
      }))
      .sort((a, b) => b.passRate - a.passRate || b.total - a.total);

    res.json(results);
  }));

  // GET /providers/compare/:provider — detailed stats for one provider
  r.get('/:provider', asyncHandler(async (req, res) => {
    const provider = req.params.provider;
    const since = typeof req.query.since === 'string'
      ? new Date(req.query.since)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    const tasks = await prisma.task.findMany({
      where: {
        provider,
        createdAt: { gte: since },
      },
      select: {
        status: true,
        model: true,
        complexity: true,
        tags: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const models = new Map<string, { total: number; passed: number; avgMs: number }>();
    for (const t of tasks) {
      const key = t.model ?? 'unknown';
      let m = models.get(key);
      if (!m) { m = { total: 0, passed: 0, avgMs: 0 }; models.set(key, m); }
      m.total++;
      if (t.status === 'done') m.passed++;
      const dur = t.updatedAt.getTime() - t.createdAt.getTime();
      m.avgMs = (m.avgMs * (m.total - 1) + dur) / m.total;
    }

    // Daily success/failure over time
    const daily: Record<string, { passed: number; failed: number }> = {};
    for (const t of tasks) {
      const day = t.createdAt.toISOString().slice(0, 10);
      if (!(day in daily)) daily[day] = { passed: 0, failed: 0 };
      if (t.status === 'done') daily[day].passed++;
      else daily[day].failed++;
    }

    res.json({
      provider,
      totalTasks: tasks.length,
      models: [...models.entries()].map(([model, s]) => ({
        model,
        ...s,
        passRate: Number((s.passed / s.total).toFixed(2)),
        avgMs: Math.round(s.avgMs),
      })),
      daily,
    });
  }));

  return r;
}
