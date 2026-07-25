import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import { omegaWorkDir } from '@omega/core';
import type { PrismaClient } from '@omega/db';
import type { BenchmarkTask, BenchmarkReport, BenchmarkEvaluation } from '@omega/bench';
import { classifyFailure, saveBenchmarkHistory } from '@omega/bench';
import { runTask } from './run-task.js';

export interface BenchRunConfig {
  suite: string;
  models?: Array<{ provider: string; model: string }>;
  strategy?: 'single' | 'consensus' | 'variance';
  concurrency?: number;
  timeoutMs?: number;
  tokenBudget?: number;
  projectPrefix?: string;
  nTasks?: number;
  taskIds?: string[];
}

export interface BenchRunStatus {
  id: string;
  suite: string;
  status: string;
  config: BenchRunConfig;
  totalTasks: number;
  passed: number;
  failed: number;
  timeouts: number;
  totalDurationMs: number;
  totalCostUsd: number | null;
  totalTokens: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface BenchRunEvent {
  type: 'started' | 'task-started' | 'task-completed' | 'completed' | 'failed';
  runId: string;
  suite?: string;
  taskId?: string;
  taskName?: string;
  model?: string;
  passed?: boolean;
  durationMs?: number;
  status?: string;
  error?: string;
  summary?: {
    total: number;
    passed: number;
    failed: number;
    timeouts: number;
    totalDurationMs: number;
  };
}

const activeRuns = new Map<string, AbortController>();

export function cancelRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  activeRuns.delete(runId);
  return true;
}

function ensureGitRepo(repoPath: string): void {
  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'ignore' });
    return;
  } catch {
    // not a git repo; initialise one.
  }
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "bench@omega.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Omega Bench"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "bench init"', { cwd: repoPath, stdio: 'ignore' });
}

async function loadSuite(
  suite: string,
  options: { nTasks?: number; taskIds?: string[] } = {},
): Promise<BenchmarkTask[]> {
  const {
    syntheticSuite,
    fastSuite,
    harderSuite,
    harderV2Suite,
    hardTargetedSuite,
  } = await import('@omega/bench');

  let tasks: BenchmarkTask[];

  switch (suite) {
    case 'synthetic': tasks = syntheticSuite(); break;
    case 'fast': tasks = fastSuite(); break;
    case 'harder': tasks = harderSuite(); break;
    case 'harder-v2': tasks = harderV2Suite(); break;
    case 'hard-targeting': tasks = hardTargetedSuite(); break;
    default: throw new Error(`Unknown suite: ${suite}`);
  }

  if (options.taskIds && options.taskIds.length > 0) {
    tasks = tasks.filter((t) => options.taskIds!.includes(t.id));
  }
  if (options.nTasks && options.nTasks > 0) {
    tasks = tasks.slice(0, options.nTasks);
  }

  return tasks;
}

async function createHarnessTask(
  prisma: PrismaClient,
  projectPath: string,
  projectName: string,
  task: BenchmarkTask,
  model?: { provider: string; model: string },
  tags: string[] = [],
): Promise<string> {
  // Ensure project exists
  let project = await prisma.project.findFirst({ where: { path: projectPath } });
  if (!project) {
    project = await prisma.project.create({
      data: { name: projectName, path: projectPath },
    });
  }

  // Create the task
  const harnessTask = await prisma.task.create({
    data: {
      projectId: project.id,
      title: task.title,
      description: task.description,
      complexity: task.complexity ?? 'simple',
      tags: JSON.stringify(['benchmark', ...tags, task.name, ...(task.tags ?? [])]),
    },
  });

  // Set provider/model if specified
  if (model) {
    await prisma.task.update({
      where: { id: harnessTask.id },
      data: { provider: model.provider, model: model.model },
    });
  }

  return harnessTask.id;
}

async function waitForTaskCompletion(
  prisma: PrismaClient,
  taskId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: string; result?: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { status: 'cancelled', error: 'Run cancelled' };
    }
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { status: 'failed', error: 'Task not found' };
    if (task.status === 'done' || task.status === 'failed') {
      return { status: task.status, result: task.result ?? undefined, error: task.error ?? undefined };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { status: 'timeout', error: 'Task did not finish in time' };
}

async function getTaskDiffs(prisma: PrismaClient, taskId: string) {
  return prisma.taskDiff.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  });
}

async function getAgentRunData(prisma: PrismaClient, taskId: string) {
  return prisma.agentRun.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function startBenchRun(
  prisma: PrismaClient,
  runId: string,
  config: BenchRunConfig,
  emitter: EventEmitter,
): Promise<void> {
  const abortController = new AbortController();
  activeRuns.set(runId, abortController);

  try {
    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt: new Date() },
    });

    emitter.emit('run', {
      type: 'started',
      runId,
      suite: config.suite,
    } satisfies BenchRunEvent);

    const tasks = await loadSuite(config.suite, {
      nTasks: config.nTasks,
      taskIds: config.taskIds,
    });

    if (tasks.length === 0) {
      await prisma.benchmarkRun.update({
        where: { id: runId },
        data: { status: 'done', completedAt: new Date(), totalTasks: 0 },
      });
      emitter.emit('run', {
        type: 'completed',
        runId,
        summary: { total: 0, passed: 0, failed: 0, timeouts: 0, totalDurationMs: 0 },
      } satisfies BenchRunEvent);
      return;
    }

    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: { totalTasks: tasks.length },
    });

    const timeoutMs = config.timeoutMs ?? 600_000;
    const projectPrefix = config.projectPrefix ?? 'bench';
    const baseDir = path.join(omegaWorkDir(), 'bench', runId);
    await fs.mkdir(baseDir, { recursive: true });

    let passed = 0;
    let failed = 0;
    let timeouts = 0;
    let totalDurationMs = 0;
    let totalCostUsd = 0;
    let totalTokens = 0;
    const results: Array<{
      taskName: string;
      harnessTaskId: string;
      passed: boolean;
      durationMs: number;
      model?: string;
      error?: string;
    }> = [];

    for (const task of tasks) {
      if (abortController.signal.aborted) break;

      const start = Date.now();
      let harnessTaskId = '';
      let evaluation: BenchmarkEvaluation = { passed: false, message: 'Task did not complete' };
      let modelUsed: string | undefined;

      try {
        const projectPath = path.join(baseDir, task.id);
        await fs.mkdir(projectPath, { recursive: true });
        if (task.setup) {
          await task.setup(projectPath);
        }
        ensureGitRepo(projectPath);

        // Pick model for this task
        const model = config.models && config.models.length > 0
          ? config.models[0] // Single mode: use first model
          : undefined;
        modelUsed = model ? `${model.provider}/${model.model}` : undefined;

        harnessTaskId = await createHarnessTask(
          prisma,
          projectPath,
          `${projectPrefix}-${task.id}`,
          task,
          model,
        );

        emitter.emit('run', {
          type: 'task-started',
          runId,
          taskId: harnessTaskId,
          taskName: task.name,
          model: modelUsed,
        } satisfies BenchRunEvent);

        // Run the task (uses existing routing + retries + queue)
        await runTask(prisma, harnessTaskId, {
          tokenBudget: config.tokenBudget,
        });

        const finished = await waitForTaskCompletion(prisma, harnessTaskId, timeoutMs, abortController.signal);
        const status = finished.status;

        // Get agent run data for cost tracking
        const agentRun = await getAgentRunData(prisma, harnessTaskId);
        if (agentRun?.costUsd) totalCostUsd += agentRun.costUsd;
        if (agentRun?.totalTokens) totalTokens += agentRun.totalTokens;

        // Get diffs for evaluation
        const diffs = await getTaskDiffs(prisma, harnessTaskId);

        // Evaluate
        evaluation = await task.evaluate({
          apiUrl: '', // Not needed for server-side evaluation
          taskId: harnessTaskId,
          projectPath,
          projectId: (await prisma.task.findUnique({ where: { id: harnessTaskId } }))?.projectId ?? '',
          agentRun: agentRun ? {
            id: agentRun.id,
            resultStatus: agentRun.resultStatus,
            totalTokens: agentRun.totalTokens ?? undefined,
            costUsd: agentRun.costUsd ?? undefined,
            createdAt: agentRun.createdAt.toISOString(),
            updatedAt: agentRun.updatedAt.toISOString(),
          } : undefined,
          diffs: diffs.map((d) => ({ id: d.id, branch: d.branch, patch: d.patch })),
        });

        if (status === 'timeout') timeouts++;
        else if (evaluation.passed) passed++;
        else failed++;
      } catch (err) {
        evaluation = {
          passed: false,
          message: err instanceof Error ? err.message : String(err),
        };
        failed++;
      }

      const durationMs = Date.now() - start;
      totalDurationMs += durationMs;

      results.push({
        taskName: task.name,
        harnessTaskId,
        passed: evaluation.passed,
        durationMs,
        model: modelUsed,
        error: evaluation.passed ? undefined : evaluation.message,
      });

      emitter.emit('run', {
        type: 'task-completed',
        runId,
        taskId: harnessTaskId,
        taskName: task.name,
        model: modelUsed,
        passed: evaluation.passed,
        durationMs,
      } satisfies BenchRunEvent);

      // Update run progress
      await prisma.benchmarkRun.update({
        where: { id: runId },
        data: {
          passed,
          failed,
          timeouts,
          totalDurationMs,
          totalCostUsd,
          totalTokens,
        },
      });
    }

    // Save to history
    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      suite: config.suite,
      total: tasks.length,
      passed,
      failed,
      timeouts,
      totalDurationMs,
      results: results.map((r) => ({
        task: tasks.find((t) => t.name === r.taskName) ?? { id: r.taskName, name: r.taskName, title: r.taskName, evaluate: () => ({ passed: false }) },
        harnessTaskId: r.harnessTaskId,
        durationMs: r.durationMs,
        status: r.passed ? 'done' as const : 'failed' as const,
        evaluation: { passed: r.passed, message: r.error },
        spanCount: 0,
      })),
    };

    try {
      await saveBenchmarkHistory(prisma, report, {
        provider: config.models?.[0]?.provider,
        model: config.models?.[0]?.model,
      });
    } catch {
      // Best-effort history save
    }

    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: {
        status: 'done',
        completedAt: new Date(),
        results: JSON.stringify(results),
      },
    });

    emitter.emit('run', {
      type: 'completed',
      runId,
      summary: { total: tasks.length, passed, failed, timeouts, totalDurationMs },
    } satisfies BenchRunEvent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: { status: 'failed', error: message, completedAt: new Date() },
    });
    emitter.emit('run', {
      type: 'failed',
      runId,
      error: message,
    } satisfies BenchRunEvent);
  } finally {
    activeRuns.delete(runId);
  }
}
