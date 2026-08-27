import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import fs from 'node:fs/promises';
import path from 'node:path';
import { omegaReportsDir } from '@omega/core';
import { asyncHandler } from '../lib/async-handler.js';
import { safeJsonParse } from '../lib/utils.js';

// Inline BenchmarkReport type to avoid adding @omega/bench as a server dep
// (the bundle deploy can't resolve workspace deps from npm).
interface BenchmarkReport {
  timestamp: string;
  suite: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  totalDurationMs: number;
  totalUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  results: {
    task: { name: string };
    status: string;
    durationMs: number;
    evaluation: { passed: boolean; score?: number };
    agentRun?: { totalTokens?: number };
  }[];
}

const reportsDir = omegaReportsDir();

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

async function loadRecentBenchmarkReports(limit = 20): Promise<BenchmarkReport[]> {
  try {
    const files = await fs.readdir(reportsDir);
    const jsonFiles = files
      .filter((f) => f.startsWith('benchmark-') && f.endsWith('.json') && !f.includes('latest'))
      .sort()
      .reverse()
      .slice(0, limit);
    const reports: BenchmarkReport[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(reportsDir, file), 'utf-8');
        reports.push(JSON.parse(raw) as BenchmarkReport);
      } catch {
        // skip malformed
      }
    }
    return reports;
  } catch {
    return [];
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
      traceSpans,
    ] = await Promise.all([
      prisma.task.findMany({
        select: { status: true, provider: true, model: true, createdAt: true, updatedAt: true },
      }),
      prisma.agentRun.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { task: { select: { title: true, provider: true, model: true } } },
      }),
      prisma.traceSpan.findMany({
        where: { name: { in: ['provider.send', 'agent.task'] } },
        take: 1000,
        orderBy: { startTime: 'desc' },
        select: { name: true, status: true, attributes: true, startTime: true, endTime: true },
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
    const providerRouting: Record<string, {
      calls: number;
      errors: number;
      retries: number;
      rateLimitRetries: number;
      rotations: number;
      durationMs: number;
      models: Set<string>;
    }> = {};
    let tokenBudgetExceededRuns = 0;

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

    for (const span of traceSpans) {
      const attrs = span.attributes ? safeJsonParse<Record<string, unknown>>(span.attributes, {}) : {};
      if (span.name === 'agent.task') {
        if (attrs.tokenBudgetExceeded === true) tokenBudgetExceededRuns++;
        continue;
      }
      const provider = typeof attrs.provider === 'string' ? attrs.provider : 'unknown';
      const stats = providerRouting[provider] ?? {
        calls: 0,
        errors: 0,
        retries: 0,
        rateLimitRetries: 0,
        rotations: 0,
        durationMs: 0,
        models: new Set<string>(),
      };
      stats.calls++;
      if (span.status === 'error') stats.errors++;
      if (typeof attrs.providerRetryCount === 'number') stats.retries += attrs.providerRetryCount;
      if (typeof attrs.providerRateLimitRetries === 'number') stats.rateLimitRetries += attrs.providerRateLimitRetries;
      if (typeof attrs.providerRotationCount === 'number') stats.rotations += attrs.providerRotationCount;
      if (typeof attrs.model === 'string') stats.models.add(attrs.model);
      if (Array.isArray(attrs.modelsTried)) {
        for (const model of attrs.modelsTried) {
          if (typeof model === 'string') stats.models.add(model);
        }
      }
      stats.durationMs += durationMs(span.startTime, span.endTime) ?? 0;
      providerRouting[provider] = stats;
    }

    const providerRoutingJson = Object.fromEntries(
      Object.entries(providerRouting).map(([provider, stats]) => [provider, {
        ...stats,
        models: [...stats.models],
        avgDurationMs: stats.calls > 0 ? Math.round(stats.durationMs / stats.calls) : 0,
      }]),
    );

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
      provider: r.task.provider,
      model: r.task.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      currentPhase: r.currentPhase,
      durationMs: durationMs(r.createdAt, r.updatedAt),
      createdAt: r.createdAt,
    }));

    const e2eReport = await latestReport(/^e2e-raw-/);
    const benchmarkReport = await latestReport(/^benchmark-/);

    // ── Core metrics from benchmark reports ──────────────────────────────
    const benchmarkReports = await loadRecentBenchmarkReports(20);
    let benchmarkPassRate: number | null = null;
    let benchmarkTotalTokens = 0;
    let benchmarkSolvedCount = 0;
    let benchmarkAvgDurationMs = 0;
    const benchmarkReportCount = benchmarkReports.length;

    if (benchmarkReports.length > 0) {
      const latest = benchmarkReports[0];
      benchmarkPassRate = latest.total > 0 ? Math.round((latest.passed / latest.total) * 100) : 0;

      for (const report of benchmarkReports) {
        for (const result of report.results) {
          const tokens = result.agentRun?.totalTokens ?? 0;
          benchmarkTotalTokens += tokens;
          if (result.evaluation.passed) {
            benchmarkSolvedCount++;
            benchmarkAvgDurationMs += result.durationMs;
          }
        }
      }
    }

    const tokensPerSolved = benchmarkSolvedCount > 0
      ? Math.round(benchmarkTotalTokens / benchmarkSolvedCount)
      : 0;
    const avgSolvedDurationMs = benchmarkSolvedCount > 0
      ? Math.round(benchmarkAvgDurationMs / benchmarkSolvedCount)
      : 0;

    // Failure taxonomy from recent task failures
    const failedTasks = tasks.filter((t) => t.status === 'failed');
    const failureByProvider: Record<string, number> = {};
    for (const t of failedTasks) {
      const key = t.provider && t.model ? `${t.provider}/${t.model}` : 'unknown';
      failureByProvider[key] = (failureByProvider[key] ?? 0) + 1;
    }

    res.json({
      taskCounts,
      totalTasks: tasks.length,
      providerUsage,
      modelUsage,
      providerRouting: providerRoutingJson,
      agentHealth: {
        tokenBudgetExceededRuns,
        traceSpanSampleSize: traceSpans.length,
      },
      avgDurationMs,
      recentRuns,
      latestReports: {
        e2e: e2eReport,
        benchmark: benchmarkReport,
      },
      // Core metrics
      benchmark: {
        passRate: benchmarkPassRate,
        totalTokens: benchmarkTotalTokens,
        tokensPerSolved,
        avgSolvedDurationMs,
        solvedCount: benchmarkSolvedCount,
        reportCount: benchmarkReportCount,
      },
      failures: {
        total: failedTasks.length,
        byProvider: failureByProvider,
      },
    });
  }));

  return r;
}
