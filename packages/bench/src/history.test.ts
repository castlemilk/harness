import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, prisma } from '@omega/db';
import {
  BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS,
  getHistoryBySuite,
  saveBenchmarkHistory,
} from './history.js';
import type { BenchmarkReport } from './types.js';

vi.hoisted(() => {
  process.env.DATABASE_DIR = `/tmp/omega-bench-history-vitest-${String(process.pid)}-${process.env.VITEST_WORKER_ID ?? '0'}`;
});

function reportWithPassingDeepSWEResult(): BenchmarkReport {
  return {
    timestamp: '2026-08-24T00:00:00.000Z',
    suite: 'deepswe',
    total: 1,
    passed: 1,
    failed: 0,
    timeouts: 0,
    totalDurationMs: 123,
    results: [{
      task: {
        id: 'deepswe-example',
        name: 'example',
        title: 'Example',
        evaluate: () => ({ passed: true }),
      },
      harnessTaskId: 'task-1',
      durationMs: 123,
      status: 'done',
      evaluation: {
        passed: true,
        score: 0.981,
        message: 'DeepSWE verifier passed with useful detail',
        metrics: {
          partial: 0.981,
          f2p_passed: 32,
          f2p_total: 32,
          p2p_passed: 1273,
          p2p_total: 1273,
          verifier_mode: 'docker',
          verifier_log_file: '/work/example/verifier.log',
          verifier_log_file_rerun: '/work/example/verifier-rerun.log',
          verifier_logs: 'a'.repeat(4096),
          verifier_logs_rerun: 'b'.repeat(4096),
        },
      },
      spanCount: 0,
    }],
  };
}

function reportWithFailingSWEBenchResult(): BenchmarkReport {
  const longOutput = 'swebench-output '.repeat(
    Math.ceil((BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS + 512) / 16),
  );
  return {
    timestamp: '2026-08-24T00:00:00.000Z',
    suite: 'swebench-history-bounds',
    total: 1,
    passed: 0,
    failed: 1,
    timeouts: 0,
    totalDurationMs: 456,
    results: [{
      task: {
        id: 'swebench-example',
        name: 'swebench example',
        title: 'SWE-bench example',
        evaluate: () => ({ passed: false }),
      },
      harnessTaskId: 'task-swebench-1',
      durationMs: 456,
      status: 'failed',
      taskError: 'runner fallback error',
      evaluation: {
        passed: false,
        score: 0.5,
        message: 'SWE-bench verifier failed with useful detail',
        metrics: {
          f2p_output: longOutput,
          p2p_output: longOutput,
          arbitrary_future_log_key: longOutput,
          f2p_passed: 1,
          f2p_total: 2,
        },
      },
      spanCount: 0,
    }],
  };
}

describe('benchmark history metadata', () => {
  beforeAll(async () => {
    await applyMigrations();
  }, 60_000);

  it('round-trips per-task evaluation detail while bounding inline verifier logs', async () => {
    const report = reportWithPassingDeepSWEResult();
    const persistedResults = report.results.map((result) => ({
      taskName: result.task.name,
      harnessTaskId: result.harnessTaskId,
      passed: result.evaluation.passed,
      durationMs: result.durationMs,
      evaluation: result.evaluation,
    }));

    await saveBenchmarkHistory(prisma, report, { metadata: { results: persistedResults } });
    const [loaded] = await getHistoryBySuite(prisma, 'deepswe');
    const metadata = JSON.parse(loaded.metadata ?? '{}') as {
      results: { evaluation: { message?: string; metrics?: Record<string, number | string> } }[];
    };
    const evaluation = metadata.results[0]?.evaluation;

    expect(evaluation?.message).toBe('DeepSWE verifier passed with useful detail');
    expect(evaluation?.metrics).toMatchObject({
      partial: 0.981,
      f2p_passed: 32,
      f2p_total: 32,
      p2p_passed: 1273,
      p2p_total: 1273,
      verifier_mode: 'docker',
      verifier_log_file: '/work/example/verifier.log',
      verifier_log_file_rerun: '/work/example/verifier-rerun.log',
    });
    expect(evaluation?.metrics?.verifier_logs).toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
    expect(evaluation?.metrics?.verifier_logs_rerun).toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
  });

  it('persists per-task results for callers that do not provide custom metadata', async () => {
    const report = reportWithPassingDeepSWEResult();
    report.suite = 'deep-swe-cli-history';

    await saveBenchmarkHistory(prisma, report);

    const [loaded] = await getHistoryBySuite(prisma, report.suite);
    const metadata = JSON.parse(loaded.metadata ?? '{}') as {
      results?: { taskName: string; evaluation: { message?: string; metrics?: Record<string, number | string> } }[];
    };
    expect(metadata.results?.[0]).toMatchObject({
      taskName: 'example',
      evaluation: {
        score: 0.981,
        message: 'DeepSWE verifier passed with useful detail',
        metrics: { partial: 0.981, f2p_passed: 32, f2p_total: 32 },
      },
    });
    expect(metadata.results?.[0]?.evaluation.metrics?.verifier_logs)
      .toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
    expect(metadata.results?.[0]?.evaluation.metrics?.verifier_logs_rerun)
      .toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
  });

  it('persists explicit zero replay usage instead of converting it to missing data', async () => {
    const report = reportWithPassingDeepSWEResult();
    report.suite = 'deepswe-replay-zero-usage';
    report.results[0].usage = { totalTokens: 0 };
    report.results[0].agentRun = {
      id: 'source-task-1',
      resultStatus: 'done',
      totalTokens: 0,
      costUsd: 0,
      createdAt: report.timestamp,
      updatedAt: report.timestamp,
    };

    await saveBenchmarkHistory(prisma, report, { provider: 'replay' });

    const [loaded] = await getHistoryBySuite(prisma, report.suite);
    expect(loaded.provider).toBe('replay');
    expect(loaded.totalCostUsd).toBe(0);
    expect(loaded.totalTokens).toBe(0);
  });

  it('bounds every string metric for a non-DeepSWE result and persists score and failure error', async () => {
    const report = reportWithFailingSWEBenchResult();

    await saveBenchmarkHistory(prisma, report);

    const [loaded] = await getHistoryBySuite(prisma, report.suite);
    const metadataText = loaded.metadata ?? '{}';
    const metadata = JSON.parse(metadataText) as {
      results?: {
        error?: string;
        evaluation: {
          score?: number;
          message?: string;
          metrics?: Record<string, number | string>;
        };
      }[];
    };
    const persisted = metadata.results?.[0];
    const metrics = persisted?.evaluation.metrics;

    expect(persisted).toMatchObject({
      error: 'SWE-bench verifier failed with useful detail',
      evaluation: {
        score: 0.5,
        message: 'SWE-bench verifier failed with useful detail',
      },
    });
    expect(metrics?.f2p_output).toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
    expect(metrics?.p2p_output).toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
    expect(metrics?.arbitrary_future_log_key).toHaveLength(BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS);
    expect(metadataText.length).toBeLessThan(
      (BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS * 3) + 1_000,
    );
  });
});
