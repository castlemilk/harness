import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { asyncHandler } from '../lib/async-handler.js';
import { classifyError, type ErrorCategory } from '../lib/utils.js';

// ─── Routes ─────────────────────────────────────────────────────────────────

export function errorRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // GET /errors — categorized recent errors with trend data
  r.get('/', asyncHandler(async (req, res) => {
    const limit = typeof req.query.limit === 'string'
      ? Math.min(parseInt(req.query.limit, 10) || 100, 500)
      : 100;
    const since = typeof req.query.since === 'string'
      ? new Date(req.query.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

    const failedTasks = await prisma.task.findMany({
      where: {
        status: 'failed',
        error: { not: null },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    interface ClassifiedError {
      taskId: string;
      title: string;
      provider: string | null;
      model: string | null;
      error: string;
      category: ErrorCategory;
      timestamp: Date;
      complexity: string;
    }

    const classified: ClassifiedError[] = failedTasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      provider: t.provider,
      model: t.model,
      error: t.error ?? '',
      category: classifyError(t.error ?? ''),
      timestamp: t.createdAt,
      complexity: t.complexity,
    }));

    // Aggregate by category
    const byCategory: Record<ErrorCategory, { count: number; providers: Record<string, number> }> = {
      auth: { count: 0, providers: {} },
      rate_limit: { count: 0, providers: {} },
      timeout: { count: 0, providers: {} },
      server_error: { count: 0, providers: {} },
      model_error: { count: 0, providers: {} },
      unknown: { count: 0, providers: {} },
    };
    for (const e of classified) {
      byCategory[e.category].count++;
      const p = e.provider ?? 'unknown';
      byCategory[e.category].providers[p] = (byCategory[e.category].providers[p] ?? 0) + 1;
    }

    // Daily trend (last 7 days)
    const dailyTrend: Record<string, Record<ErrorCategory, number>> = {};
    for (const e of classified) {
      const day = e.timestamp.toISOString().slice(0, 10);
      if (!(day in dailyTrend)) dailyTrend[day] = { auth: 0, rate_limit: 0, timeout: 0, server_error: 0, model_error: 0, unknown: 0 };
      dailyTrend[day][e.category]++;
    }

    // Most common error messages (top 5)
    const errorCounts = new Map<string, { count: number; category: ErrorCategory; sample: string }>();
    for (const e of classified) {
      const key = e.error.slice(0, 100);
      const existing = errorCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        errorCounts.set(key, { count: 1, category: e.category, sample: e.error.slice(0, 300) });
      }
    }
    const topErrors = [...errorCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([key, v]) => ({ pattern: key, count: v.count, category: v.category, sample: v.sample }));

    res.json({
      total: classified.length,
      byCategory,
      dailyTrend,
      topErrors,
      recent: classified.slice(0, 20),
    });
  }));

  return r;
}
