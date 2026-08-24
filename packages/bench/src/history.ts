import type { PrismaClient } from '@omega/db';
import type { BenchmarkReport } from './types.js';

/**
 * Maximum persisted length of each string-valued evaluation metric. The full
 * evaluation remains available on the live report, while history applies the
 * same bound to output from every benchmark adapter regardless of metric key.
 */
export const BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS: number = 2_048;

function boundHistoryMetadata(value: unknown, withinMetrics: boolean = false): unknown {
  if (withinMetrics && typeof value === 'string') {
    return value.slice(0, BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => boundHistoryMetadata(entry, withinMetrics));
  }
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return value;

  const bounded: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    bounded[entryKey] = boundHistoryMetadata(entryValue, withinMetrics || entryKey === 'metrics');
  }
  return bounded;
}

export interface BenchmarkHistoryEntry {
  id: string;
  suite: string;
  provider: string | null;
  model: string | null;
  totalTasks: number;
  passed: number;
  failed: number;
  timeouts: number;
  passRate: number;
  totalDurationMs: number;
  totalCostUsd: number | null;
  totalTokens: number | null;
  metadata: string | null;
  reportPath: string | null;
  createdAt: Date;
}

export interface CostPerPassRate {
  provider: string;
  model: string;
  totalRuns: number;
  totalPasses: number;
  passRate: number;
  totalCostUsd: number;
  costPerPassPercent: number;
  avgDurationMs: number;
}

export async function saveBenchmarkHistory(
  prisma: PrismaClient,
  report: BenchmarkReport,
  options: {
    provider?: string;
    model?: string;
    reportPath?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<BenchmarkHistoryEntry> {
  const hasExplicitCost = report.results.some((result) => result.agentRun?.costUsd !== undefined);
  const hasExplicitTokens = report.results.some((result) =>
    result.usage?.totalTokens !== undefined || result.agentRun?.totalTokens !== undefined,
  );
  const totalCostUsd = report.results.reduce((sum, result) => sum + (result.agentRun?.costUsd ?? 0), 0);
  const totalTokens = report.results.reduce(
    (sum, result) => sum + (result.usage?.totalTokens ?? result.agentRun?.totalTokens ?? 0),
    0,
  );
  const metadata: Record<string, unknown> = {
    // Supply a useful default for every writer (including the CLI). Callers
    // can replace this with a richer strategy-specific result shape.
    results: report.results.map((result) => ({
      taskName: result.task.name,
      harnessTaskId: result.harnessTaskId,
      passed: result.evaluation.passed,
      durationMs: result.durationMs,
      evaluation: result.evaluation,
      error: result.evaluation.passed ? undefined : (result.evaluation.message ?? result.taskError),
    })),
    ...options.metadata,
  };
  return prisma.benchmarkHistory.create({
    data: {
      suite: report.suite,
      provider: options.provider ?? null,
      model: options.model ?? null,
      totalTasks: report.total,
      passed: report.passed,
      failed: report.failed,
      timeouts: report.timeouts,
      passRate: report.total > 0 ? report.passed / report.total : 0,
      totalDurationMs: report.totalDurationMs,
      totalCostUsd: hasExplicitCost ? totalCostUsd : null,
      totalTokens: hasExplicitTokens ? totalTokens : null,
      metadata: JSON.stringify(boundHistoryMetadata(metadata)),
      reportPath: options.reportPath ?? null,
    },
  });
}

export async function getHistoryBySuite(
  prisma: PrismaClient,
  suite: string,
  limit: number = 50,
): Promise<BenchmarkHistoryEntry[]> {
  return prisma.benchmarkHistory.findMany({
    where: { suite },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getCostPerPassRate(
  prisma: PrismaClient,
  suite?: string,
): Promise<CostPerPassRate[]> {
  const where = suite ? { suite } : {};
  const runs = await prisma.benchmarkHistory.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const grouped = new Map<string, {
    provider: string;
    model: string;
    totalTasks: number;
    passed: number;
    totalCost: number;
    totalDuration: number;
    runs: number;
  }>();

  for (const run of runs) {
    const provider = run.provider ?? 'unknown';
    const model = run.model ?? 'unknown';
    const key = `${provider}/${model}`;
    const existing = grouped.get(key) ?? {
      provider,
      model,
      totalTasks: 0,
      passed: 0,
      totalCost: 0,
      totalDuration: 0,
      runs: 0,
    };
    existing.totalTasks += run.totalTasks;
    existing.passed += run.passed;
    existing.totalCost += run.totalCostUsd ?? 0;
    existing.totalDuration += run.totalDurationMs;
    existing.runs++;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map((g) => {
    const passRate = g.totalTasks > 0 ? g.passed / g.totalTasks : 0;
    const costPerPassPercent = passRate > 0 ? g.totalCost / (passRate * 100) : Infinity;
    return {
      provider: g.provider,
      model: g.model,
      totalRuns: g.runs,
      totalPasses: g.passed,
      passRate,
      totalCostUsd: g.totalCost,
      costPerPassPercent: Math.round(costPerPassPercent * 1_000_000) / 1_000_000,
      avgDurationMs: g.runs > 0 ? Math.round(g.totalDuration / g.runs) : 0,
    };
  }).sort((a, b) => a.costPerPassPercent - b.costPerPassPercent);
}

export async function getPassRateTrend(
  prisma: PrismaClient,
  suite: string,
  provider?: string,
  model?: string,
  limit: number = 20,
): Promise<{
  timestamp: string;
  passRate: number;
  totalTasks: number;
  passed: number;
  totalCostUsd: number | null;
}[]> {
  const where: Record<string, unknown> = { suite };
  if (provider) where.provider = provider;
  if (model) where.model = model;

  const runs = await prisma.benchmarkHistory.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return runs.reverse().map((r) => ({
    timestamp: r.createdAt.toISOString(),
    passRate: r.passRate,
    totalTasks: r.totalTasks,
    passed: r.passed,
    totalCostUsd: r.totalCostUsd,
  }));
}
