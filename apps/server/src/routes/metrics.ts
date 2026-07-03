import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncHandler } from '../lib/async-handler.js';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '..', '..', '..', '..');
const reportsDir = path.join(root, '.omega', 'reports');

async function latestReport(pattern: RegExp): Promise<{ file: string; data: unknown } | undefined> {
  try {
    const files = await fs.readdir(reportsDir);
    const matches = files
      .filter((f) => pattern.test(f))
      .sort()
      .reverse();
    const latest = matches[0];
    if (!latest) return undefined;
    const raw = await fs.readFile(path.join(reportsDir, latest), 'utf-8');
    const data = latest.endsWith('.json') ? (JSON.parse(raw) as unknown) : raw;
    return { file: latest, data };
  } catch {
    return undefined;
  }
}

function durationMs(start: Date, end: Date | null): number | undefined {
  if (!end) return undefined;
  return end.getTime() - start.getTime();
}

export function metricsRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (_req, res) => {
    const [
      tasks,
      agentRuns,
    ] = await Promise.all([
      prisma.task.findMany({
        select: { status: true, provider: true, model: true },
      }),
      prisma.agentRun.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { task: { select: { title: true } } },
      }),
    ]);

    const taskCounts = {
      todo: 0,
      in_progress: 0,
      done: 0,
      failed: 0,
    };
    const providerUsage: Record<string, number> = {};
    const modelUsage: Record<string, number> = {};

    for (const task of tasks) {
      taskCounts[task.status as keyof typeof taskCounts]++;
      if (task.provider && task.model) {
        const key = `${task.provider}/${task.model}`;
        providerUsage[key] = (providerUsage[key] ?? 0) + 1;
      }
      if (task.model) {
        modelUsage[task.model] = (modelUsage[task.model] ?? 0) + 1;
      }
    }

    const completedRuns = agentRuns.filter((r) => r.resultStatus !== 'running');
    const avgDurationMs =
      completedRuns.length > 0
        ? Math.round(
            completedRuns.reduce((sum, r) => sum + (durationMs(r.createdAt, r.updatedAt) ?? 0), 0) /
              completedRuns.length
          )
        : 0;

    const recentRuns = agentRuns.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      title: r.task.title,
      branch: r.branch,
      resultStatus: r.resultStatus,
      baseCommit: r.baseCommit,
      validationSummary: r.validationSummary,
      publishedVersion: r.publishedVersion,
      durationMs: durationMs(r.createdAt, r.updatedAt),
      createdAt: r.createdAt,
    }));

    const e2eReport = await latestReport(/^e2e-raw-/);
    const benchmarkReport = await latestReport(/^benchmark-/);

    res.json({
      taskCounts,
      totalTasks: tasks.length,
      providerUsage,
      modelUsage,
      avgDurationMs,
      recentRuns,
      latestReports: {
        e2e: e2eReport,
        benchmark: benchmarkReport,
      },
    });
  }));

  return r;
}
