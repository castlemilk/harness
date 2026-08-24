import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import type { BenchmarkEvaluation, BenchmarkReport, BenchmarkTask } from '@omega/bench';

const mocks = vi.hoisted(() => ({
  workDir: '',
  loadDeepSWESuite: vi.fn(),
  saveBenchmarkHistory: vi.fn(),
  runTask: vi.fn(),
}));

vi.mock('@omega/core', () => ({
  omegaWorkDir: () => mocks.workDir,
}));

vi.mock('@omega/bench', () => ({
  BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS: 2_048,
  loadDeepSWESuite: mocks.loadDeepSWESuite,
  saveBenchmarkHistory: mocks.saveBenchmarkHistory,
}));

vi.mock('./run-task.js', () => ({
  runTask: mocks.runTask,
}));

import {
  cancelRun,
  serializeVarianceRunOutcomes,
  startBenchRun,
  type BenchRunEvent,
} from './benchmark-runner.js';

describe('startBenchRun per-task evaluation reporting', () => {
  beforeEach(async () => {
    mocks.workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-benchmark-runner-'));
    mocks.loadDeepSWESuite.mockReset();
    mocks.saveBenchmarkHistory.mockReset();
    mocks.runTask.mockReset().mockResolvedValue({ status: 'done' });
  });

  afterEach(async () => {
    if (mocks.workDir) await fs.rm(mocks.workDir, { recursive: true, force: true });
  });

  it('keeps a passing evaluation in the SSE event, run detail, report, and history metadata', async () => {
    const evaluation: BenchmarkEvaluation = {
      passed: true,
      score: 0.981,
      message: 'passing verifier detail must survive',
      metrics: {
        partial: 0.981,
        f2p_passed: 32,
        f2p_total: 32,
        p2p_passed: 1273,
        p2p_total: 1273,
        verifier_mode: 'docker',
        verifier_log_file: '/work/example/verifier.log',
        verifier_logs: 'full live log',
      },
    };
    const task: BenchmarkTask = {
      id: 'deepswe-example',
      name: 'example',
      title: 'Example',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: () => evaluation,
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);

    const updates: { data: Record<string, unknown> }[] = [];
    const prisma = {
      benchmarkRun: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push({ data });
          return data;
        }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-1' }),
      },
      task: {
        create: vi.fn().mockResolvedValue({ id: 'harness-task-1' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const events: BenchRunEvent[] = [];
    const emitter = new EventEmitter();
    emitter.on('run', (event: BenchRunEvent) => { events.push(event); });

    await startBenchRun(prisma, 'run-1', {
      suite: 'deepswe',
      timeoutMs: 60_000,
      models: [{ provider: 'external:codex', model: 'gpt-5' }],
      deepswe: { tasksDir: '/unused' },
    }, emitter);

    expect(mocks.loadDeepSWESuite).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 60_000 }));

    const completedTask = events.find((event) => event.type === 'task-completed');
    expect(completedTask).toMatchObject({
      type: 'task-completed',
      passed: true,
      evaluation,
    });

    const finalUpdate = updates.find((update) => update.data.status === 'done');
    const runResults = JSON.parse(String(finalUpdate?.data.results)) as {
      error?: string;
      evaluation?: BenchmarkEvaluation;
    }[];
    expect(runResults[0]?.error).toBeUndefined();
    expect(runResults[0]?.evaluation).toEqual(evaluation);

    expect(mocks.saveBenchmarkHistory).toHaveBeenCalledOnce();
    const [, report, options] = mocks.saveBenchmarkHistory.mock.calls[0] as [
      PrismaClient,
      BenchmarkReport,
      { metadata?: { results?: { evaluation?: BenchmarkEvaluation }[] } },
    ];
    expect(report.results[0]?.evaluation).toEqual(evaluation);
    expect(options.metadata?.results?.[0]?.evaluation).toEqual(evaluation);

    const summary = events.find((event) => event.type === 'completed')?.summary;
    expect(summary).toMatchObject({ passed: 1, failed: 0, timeouts: 0 });
  });

  it('keeps progress compact while the terminal result and history retain errors, evaluation, and usage', async () => {
    const verifierLogs = 'verifier output\n'.repeat(1_000);
    const evaluation: BenchmarkEvaluation = {
      passed: false,
      score: 0.25,
      message: 'the verifier found a real failure',
      metrics: {
        partial: 0.25,
        f2p_passed: 1,
        f2p_total: 4,
        verifier_mode: 'docker',
        verifier_logs: verifierLogs,
      },
    };
    const task: BenchmarkTask = {
      id: 'deepswe-compact-progress',
      name: 'compact-progress',
      title: 'Compact progress',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: () => evaluation,
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);

    const updates: { data: Record<string, unknown> }[] = [];
    const prisma = {
      benchmarkRun: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push({ data });
          return data;
        }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-compact-progress' }),
      },
      task: {
        create: vi.fn().mockResolvedValue({ id: 'task-compact-progress' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'agent-run-compact-progress',
          resultStatus: 'failed',
          validationSummary: 'failed verification',
          totalTokens: 1_234,
          costUsd: 0.42,
          createdAt: new Date('2026-08-24T00:00:00.000Z'),
          updatedAt: new Date('2026-08-24T00:01:00.000Z'),
        }),
      },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await startBenchRun(prisma, 'run-compact-progress', {
      suite: 'deepswe',
      timeoutMs: 30_000,
      deepswe: { tasksDir: '/unused' },
    }, new EventEmitter());

    const progressUpdate = updates.find((update) =>
      update.data.results !== undefined && update.data.status === undefined,
    );
    const progressResults = JSON.parse(String(progressUpdate?.data.results)) as {
      error?: string;
      evaluation: BenchmarkEvaluation;
      costUsd?: number;
      totalTokens?: number;
    }[];
    expect(progressResults[0]).toMatchObject({
      error: evaluation.message,
      costUsd: 0.42,
      totalTokens: 1_234,
      evaluation: {
        passed: false,
        score: 0.25,
        metrics: { partial: 0.25, f2p_passed: 1, f2p_total: 4 },
      },
    });
    expect(progressResults[0]?.evaluation.metrics).not.toHaveProperty('verifier_logs');
    expect(progressResults[0]?.evaluation.metrics).not.toHaveProperty('verifier_mode');
    expect(String(progressUpdate?.data.results)).not.toContain(verifierLogs);

    const terminalUpdate = updates.find((update) => update.data.status === 'done');
    expect(terminalUpdate?.data).toMatchObject({
      totalCostUsd: 0.42,
      totalTokens: 1_234,
    });
    const terminalResults = JSON.parse(String(terminalUpdate?.data.results)) as {
      error?: string;
      evaluation: BenchmarkEvaluation;
      costUsd?: number;
      totalTokens?: number;
    }[];
    expect(terminalResults[0]).toMatchObject({
      error: evaluation.message,
      evaluation,
      costUsd: 0.42,
      totalTokens: 1_234,
    });
    const snapshotsContainingFullLogs = updates.filter((update) => {
      if (typeof update.data.results !== 'string') return false;
      const snapshot = JSON.parse(update.data.results) as {
        evaluation?: BenchmarkEvaluation;
      }[];
      return snapshot[0]?.evaluation?.metrics?.verifier_logs === verifierLogs;
    });
    expect(snapshotsContainingFullLogs).toHaveLength(1);

    const [, report, options] = mocks.saveBenchmarkHistory.mock.calls[0] as [
      PrismaClient,
      BenchmarkReport,
      {
        metadata?: {
          results?: {
            error?: string;
            costUsd?: number;
            totalTokens?: number;
            evaluation?: BenchmarkEvaluation;
          }[];
        };
      },
    ];
    expect(report.totalUsage?.totalTokens).toBe(1_234);
    expect(report.results[0]).toMatchObject({
      usage: { totalTokens: 1_234 },
      agentRun: { costUsd: 0.42, totalTokens: 1_234 },
      evaluation,
    });
    expect(options.metadata?.results?.[0]).toMatchObject({
      error: evaluation.message,
      costUsd: 0.42,
      totalTokens: 1_234,
      evaluation,
    });
  });

  it('finishes the pool when a best-effort progress snapshot fails', async () => {
    const task: BenchmarkTask = {
      id: 'deepswe-progress-failure',
      name: 'progress-failure',
      title: 'Progress failure',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: () => ({ passed: true, message: 'passed despite snapshot failure' }),
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    let rejectedSnapshot = false;
    const prisma = {
      benchmarkRun: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (!rejectedSnapshot && data.results !== undefined && data.status === undefined) {
            rejectedSnapshot = true;
            throw new Error('progress snapshot unavailable');
          }
          return data;
        }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-progress-failure' }),
      },
      task: {
        create: vi.fn().mockResolvedValue({ id: 'task-progress-failure' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const outcome = await Promise.race([
      startBenchRun(prisma, 'run-progress-failure', {
        suite: 'deepswe',
        timeoutMs: 30_000,
        deepswe: { tasksDir: '/unused' },
      }, new EventEmitter()).then(() => 'done'),
      new Promise<string>((resolve) => setTimeout(() => resolve('wedged'), 250)),
    ]);

    expect(outcome).toBe('done');
    expect(rejectedSnapshot).toBe(true);
    expect(mocks.saveBenchmarkHistory).toHaveBeenCalledOnce();
  });

  it('uses the advertised timeout for every consensus agent attempt', async () => {
    const task: BenchmarkTask = {
      id: 'deepswe-consensus',
      name: 'consensus',
      title: 'Consensus',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: () => ({ passed: false, message: 'no candidate passed' }),
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    let taskNumber = 0;
    const prisma = {
      benchmarkRun: { update: vi.fn().mockResolvedValue({}) },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-consensus' }),
      },
      task: {
        create: vi.fn(async () => ({ id: `consensus-task-${String(++taskNumber)}` })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await startBenchRun(prisma, 'run-consensus', {
      suite: 'deepswe',
      strategy: 'consensus',
      timeoutMs: 45_000,
      models: [
        { provider: 'external:codex', model: 'gpt-5-a' },
        { provider: 'external:codex', model: 'gpt-5-b' },
      ],
      deepswe: { tasksDir: '/unused' },
    }, new EventEmitter());

    expect(mocks.runTask).toHaveBeenCalledTimes(2);
    for (const call of mocks.runTask.mock.calls) {
      expect(call[2]).toMatchObject({
        timeoutMs: 45_000,
        signal: expect.objectContaining({ aborted: false }),
      });
    }
  });

  it('preserves the winning consensus candidate evaluation', async () => {
    const evaluation: BenchmarkEvaluation = {
      passed: true,
      score: 0.97,
      message: 'winning adapter evaluation',
      metrics: { partial: 0.97, f2p_passed: 10, f2p_total: 10 },
    };
    const task: BenchmarkTask = {
      id: 'deepswe-consensus-evaluation',
      name: 'consensus-evaluation',
      title: 'Consensus evaluation',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: vi.fn().mockResolvedValue(evaluation),
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    let taskNumber = 0;
    const patch = [
      'diff --git a/fixture.txt b/fixture.txt',
      '--- a/fixture.txt',
      '+++ b/fixture.txt',
      '@@ -1 +1 @@',
      '-fixture',
      '+winner',
      '',
    ].join('\n');
    const prisma = {
      benchmarkRun: { update: vi.fn().mockResolvedValue({}) },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-consensus-evaluation' }),
      },
      task: {
        create: vi.fn(async () => ({ id: `consensus-evaluation-task-${String(++taskNumber)}` })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([{ id: 'diff-1', branch: 'candidate', patch }]) },
    } as unknown as PrismaClient;

    await startBenchRun(prisma, 'run-consensus-evaluation', {
      suite: 'deepswe',
      strategy: 'consensus',
      timeoutMs: 45_000,
      models: [
        { provider: 'external:codex', model: 'gpt-5-a' },
        { provider: 'external:codex', model: 'gpt-5-b' },
      ],
      deepswe: { tasksDir: '/unused' },
    }, new EventEmitter());

    const historyReport = mocks.saveBenchmarkHistory.mock.calls[0]?.[1] as BenchmarkReport;
    expect(historyReport.results[0]?.evaluation).toEqual({
      ...evaluation,
      metrics: { ...evaluation.metrics, winnerModel: 'external:codex/gpt-5-a' },
    });
  });

  it('pairs a failed consensus evaluation with the candidate that produced it', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ passed: false, score: 0.4, message: 'first candidate failed' })
      .mockResolvedValueOnce({ passed: false, score: 0.8, message: 'second candidate failed' });
    const task: BenchmarkTask = {
      id: 'deepswe-consensus-failure',
      name: 'consensus-failure',
      title: 'Consensus failure',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate,
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    let taskNumber = 0;
    const prisma = {
      benchmarkRun: { update: vi.fn().mockResolvedValue({}) },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-consensus-failure' }),
      },
      task: {
        create: vi.fn(async () => ({ id: `consensus-failure-task-${String(++taskNumber)}` })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: {
        findMany: vi.fn(({ where }: { where: { taskId: string } }) => {
          const replacement = where.taskId.endsWith('-1') ? 'miss-one' : 'miss-two';
          const candidatePatch = [
            'diff --git a/fixture.txt b/fixture.txt',
            '--- a/fixture.txt',
            '+++ b/fixture.txt',
            '@@ -1 +1 @@',
            '-fixture',
            `+${replacement}`,
            '',
          ].join('\n');
          return [{ id: `diff-${where.taskId}`, branch: 'candidate', patch: candidatePatch }];
        }),
      },
    } as unknown as PrismaClient;

    await startBenchRun(prisma, 'run-consensus-failure', {
      suite: 'deepswe',
      strategy: 'consensus',
      timeoutMs: 45_000,
      models: [
        { provider: 'external:codex', model: 'gpt-5-a' },
        { provider: 'external:codex', model: 'gpt-5-b' },
      ],
      deepswe: { tasksDir: '/unused' },
    }, new EventEmitter());

    const historyReport = mocks.saveBenchmarkHistory.mock.calls[0]?.[1] as BenchmarkReport;
    expect(historyReport.results[0]).toMatchObject({
      harnessTaskId: 'consensus-failure-task-2',
      evaluation: { passed: false, score: 0.8, message: 'second candidate failed' },
    });
  });

  it('retains ordered per-run outcomes for the variance strategy', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ passed: false, score: 0.2, message: 'first miss', metrics: { partial: 0.2, f2p_passed: 2, f2p_total: 10 } })
      .mockResolvedValueOnce({ passed: true, score: 1, message: 'second pass', metrics: { partial: 1, f2p_passed: 10, f2p_total: 10 } })
      .mockResolvedValueOnce({
        passed: true,
        score: 0.9,
        message: 'third pass',
        metrics: {
          partial: 0.9,
          f2p_passed: 9,
          f2p_total: 10,
          p2p_passed: 20,
          p2p_total: 20,
          verifier_mode: 'docker',
          verifier_log_file: '/tmp/third-verifier.log',
          verifier_logs: 'do not duplicate inline logs into outcomes',
        },
      });
    const task: BenchmarkTask = {
      id: 'deepswe-variance',
      name: 'variance',
      title: 'Variance',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate,
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    let taskNumber = 0;
    const prisma = {
      benchmarkRun: { update: vi.fn().mockResolvedValue({}) },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-variance' }),
      },
      task: {
        create: vi.fn(async () => ({ id: `variance-task-${String(++taskNumber)}` })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await startBenchRun(prisma, 'run-variance', {
      suite: 'deepswe',
      strategy: 'variance',
      varianceRuns: 3,
      timeoutMs: 30_000,
      models: [{ provider: 'external:codex', model: 'gpt-5' }],
      deepswe: { tasksDir: '/unused' },
    }, new EventEmitter());

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(mocks.runTask).toHaveBeenCalledTimes(3);
    const historyReport = (mocks.saveBenchmarkHistory.mock.calls[0]?.[1] as BenchmarkReport);
    const evaluation = historyReport.results[0]?.evaluation;
    expect(evaluation).toMatchObject({
      passed: true,
      score: 0.9,
      metrics: {
        passRate: 2 / 3,
        passes: 2,
        nRuns: 3,
        partial: 0.9,
        f2p_passed: 9,
        f2p_total: 10,
        p2p_passed: 20,
        p2p_total: 20,
        verifier_mode: 'docker',
      },
    });

    const outcomes = JSON.parse(String(evaluation?.metrics?.variance_run_outcomes)) as {
      run: number;
      harnessTaskId: string;
      passed: boolean;
      score?: number;
      durationMs: number;
      metrics?: Record<string, number | string>;
    }[];
    expect(outcomes).toEqual([
      expect.objectContaining({
        run: 1,
        harnessTaskId: 'variance-task-1',
        passed: false,
        score: 0.2,
        durationMs: expect.any(Number),
        metrics: { partial: 0.2, f2p_passed: 2, f2p_total: 10 },
      }),
      expect.objectContaining({ run: 2, harnessTaskId: 'variance-task-2', passed: true, score: 1, durationMs: expect.any(Number) }),
      expect.objectContaining({ run: 3, harnessTaskId: 'variance-task-3', passed: true, score: 0.9, durationMs: expect.any(Number) }),
    ]);
    expect(outcomes[2]?.metrics).toMatchObject({ partial: 0.9 });
    expect(outcomes[2]?.metrics).not.toHaveProperty('verifier_mode');
    expect(outcomes[2]?.metrics).not.toHaveProperty('verifier_log_file');
    expect(outcomes[2]?.metrics).not.toHaveProperty('verifier_logs');
  });

  it('does not classify cumulative variance duration as one attempt timeout', async () => {
    let now = 100_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const task: BenchmarkTask = {
      id: 'deepswe-variance-duration',
      name: 'variance-duration',
      title: 'Variance duration',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: () => {
        now += 4_000;
        return { passed: false, message: 'normal failed attempt' };
      },
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    let taskNumber = 0;
    const prisma = {
      benchmarkRun: { update: vi.fn().mockResolvedValue({}) },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-variance-duration' }),
      },
      task: {
        create: vi.fn(async () => ({ id: `variance-duration-task-${String(++taskNumber)}` })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const events: BenchRunEvent[] = [];
    const emitter = new EventEmitter();
    emitter.on('run', (event: BenchRunEvent) => { events.push(event); });

    try {
      await startBenchRun(prisma, 'run-variance-duration', {
        suite: 'deepswe',
        strategy: 'variance',
        varianceRuns: 3,
        timeoutMs: 10_000,
        deepswe: { tasksDir: '/unused' },
      }, emitter);
    } finally {
      nowSpy.mockRestore();
    }

    expect(events.find((event) => event.type === 'completed')?.summary).toMatchObject({
      passed: 0,
      failed: 1,
      timeouts: 0,
    });
  });

  it('retains completed variance outcomes when a later repetition errors', async () => {
    const evaluate = vi.fn().mockResolvedValue({ passed: true, score: 1, message: 'first pass' });
    const task: BenchmarkTask = {
      id: 'deepswe-variance-incomplete',
      name: 'variance-incomplete',
      title: 'Variance incomplete',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate,
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    mocks.runTask
      .mockResolvedValueOnce({ status: 'done' })
      .mockRejectedValueOnce(new Error('provider unavailable'));
    let taskNumber = 0;
    const prisma = {
      benchmarkRun: { update: vi.fn().mockResolvedValue({}) },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-variance-incomplete' }),
      },
      task: {
        create: vi.fn(async () => ({ id: `variance-incomplete-task-${String(++taskNumber)}` })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'done' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await startBenchRun(prisma, 'run-variance-incomplete', {
      suite: 'deepswe',
      strategy: 'variance',
      varianceRuns: 3,
      timeoutMs: 30_000,
      models: [{ provider: 'external:codex', model: 'gpt-5' }],
      deepswe: { tasksDir: '/unused' },
    }, new EventEmitter());

    expect(evaluate).toHaveBeenCalledOnce();
    const historyReport = mocks.saveBenchmarkHistory.mock.calls[0]?.[1] as BenchmarkReport;
    const evaluation = historyReport.results[0]?.evaluation;
    expect(evaluation).toMatchObject({
      passed: false,
      metrics: {
        passRate: 1 / 3,
        completedPassRate: 0.5,
        passes: 1,
        nRuns: 3,
        completedRuns: 2,
        variance_incomplete: 1,
      },
    });
    const outcomes = JSON.parse(String(evaluation?.metrics?.variance_run_outcomes)) as {
      run: number;
      harnessTaskId: string;
      passed: boolean;
      error?: string;
    }[];
    expect(outcomes).toEqual([
      expect.objectContaining({ run: 1, harnessTaskId: 'variance-incomplete-task-1', passed: true }),
      expect.objectContaining({ run: 2, harnessTaskId: '', passed: false, error: 'provider unavailable' }),
    ]);
  });

  it('records an aborted variance repetition explicitly', async () => {
    const task: BenchmarkTask = {
      id: 'deepswe-variance-cancelled',
      name: 'variance-cancelled',
      title: 'Variance cancelled',
      setup: async (projectPath) => {
        await fs.writeFile(path.join(projectPath, 'fixture.txt'), 'fixture\n', 'utf-8');
      },
      evaluate: vi.fn().mockResolvedValue({ passed: true, message: 'must not evaluate after cancellation' }),
    };
    mocks.loadDeepSWESuite.mockResolvedValue([task]);
    mocks.runTask.mockImplementation(async (_prisma, _taskId, options) => {
      expect(options).toEqual(expect.objectContaining({
        signal: expect.objectContaining({ aborted: false }),
      }));
      expect(cancelRun('run-variance-cancelled')).toBe(true);
      return { status: 'done' };
    });
    const updates: { data: Record<string, unknown> }[] = [];
    const prisma = {
      benchmarkRun: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push({ data });
          return data;
        }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'project-variance-cancelled' }),
      },
      task: {
        create: vi.fn().mockResolvedValue({ id: 'variance-cancelled-task-1' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ status: 'running' }),
      },
      agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const events: BenchRunEvent[] = [];
    const emitter = new EventEmitter();
    emitter.on('run', (event: BenchRunEvent) => { events.push(event); });

    await startBenchRun(prisma, 'run-variance-cancelled', {
      suite: 'deepswe',
      strategy: 'variance',
      varianceRuns: 3,
      // A zero duration crosses the clamped threshold, so this assertion fails
      // if cancelled outcomes ever re-enter timeout inference.
      timeoutMs: 5_000,
      deepswe: { tasksDir: '/unused' },
    }, emitter);

    expect(task.evaluate).not.toHaveBeenCalled();
    const report = mocks.saveBenchmarkHistory.mock.calls[0]?.[1] as BenchmarkReport;
    expect(report.timeouts).toBe(0);
    expect(report.results[0]?.evaluation.metrics).toMatchObject({
      completedRuns: 0,
      variance_incomplete: 1,
      variance_cancelled: 1,
    });
    const outcomes = JSON.parse(
      String(report.results[0]?.evaluation.metrics?.variance_run_outcomes),
    ) as { run: number; cancelled?: boolean; error?: string }[];
    expect(outcomes).toEqual([
      expect.objectContaining({ run: 1, cancelled: true, error: 'Run cancelled' }),
    ]);

    const terminalUpdate = updates.find((update) => update.data.completedAt !== undefined);
    expect(terminalUpdate?.data).toMatchObject({
      status: 'cancelled',
      failed: 1,
      timeouts: 0,
      results: expect.any(String),
    });
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      status: 'cancelled',
      summary: { failed: 1, timeouts: 0 },
    });
  });

  it('serializes variance outcomes as bounded, parseable JSON without string metric blobs', () => {
    const serialized = serializeVarianceRunOutcomes(Array.from({ length: 100 }, (_, index) => ({
      run: index + 1,
      harnessTaskId: `task-${String(index + 1)}`,
      passed: index % 2 === 0,
      score: index / 100,
      durationMs: 123,
      metrics: {
        partial: index / 100,
        arbitrary_output_blob: 'x'.repeat(10_000),
      },
    })));

    expect(serialized.length).toBeLessThanOrEqual(2_048);
    const outcomes = JSON.parse(serialized) as {
      run: number;
      omittedRuns?: number;
      metrics?: Record<string, number | string>;
    }[];
    expect(outcomes[0]?.omittedRuns).toBeGreaterThan(0);
    expect(outcomes.at(-1)?.run).toBe(100);
    expect(outcomes.some((outcome) => outcome.metrics?.arbitrary_output_blob !== undefined)).toBe(false);
  });
});
