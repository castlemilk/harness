import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execSync, execFileSync } from 'node:child_process';
import { omegaWorkDir } from '@omega/core';
import type { PrismaClient } from '@omega/db';
import type { BenchmarkTask, BenchmarkReport, BenchmarkEvaluation } from '@omega/bench';
import { saveBenchmarkHistory } from '@omega/bench';
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
  /** For variance mode: number of runs per task. */
  varianceRuns?: number;
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
  /** For consensus: which model won this task. */
  winnerModel?: string;
  /** For variance: pass rate across runs. */
  variancePassRate?: number;
  summary?: {
    total: number;
    passed: number;
    failed: number;
    timeouts: number;
    totalDurationMs: number;
    /** For consensus: wins per model. */
    winsByModel?: Record<string, number>;
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

// ─── Git utilities ───────────────────────────────────────────────────────────

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

function getBaseCommit(repoPath: string): string {
  return execSync('git rev-parse HEAD', { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}

function resetToCommit(repoPath: string, commit: string): void {
  execSync(`git checkout -f ${commit}`, { cwd: repoPath, stdio: 'ignore' });
  execSync('git clean -fd', { cwd: repoPath, stdio: 'ignore' });
}

function tryGitApply(repoPath: string, patch: string): boolean {
  const tmp = path.join(repoPath, '.bench-apply.patch');
  try {
    require('node:fs').writeFileSync(tmp, patch.endsWith('\n') ? patch : `${patch}\n`);
    try {
      execFileSync('git', ['apply', '--whitespace=nowarn', tmp], { cwd: repoPath, stdio: 'ignore' });
      return true;
    } catch {
      try {
        execFileSync('git', ['apply', '--3way', '--whitespace=nowarn', tmp], { cwd: repoPath, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
  } finally {
    try { require('node:fs').unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ─── Suite loading ───────────────────────────────────────────────────────────

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

// ─── Harness task helpers ────────────────────────────────────────────────────

async function ensureProject(prisma: PrismaClient, name: string, projectPath: string): Promise<string> {
  let project = await prisma.project.findFirst({ where: { path: projectPath } });
  if (!project) {
    project = await prisma.project.create({ data: { name, path: projectPath } });
  }
  return project.id;
}

async function createHarnessTask(
  prisma: PrismaClient,
  projectId: string,
  task: BenchmarkTask,
  model?: { provider: string; model: string },
  tags: string[] = [],
): Promise<string> {
  const harnessTask = await prisma.task.create({
    data: {
      projectId,
      title: task.title,
      description: task.description,
      complexity: task.complexity ?? 'simple',
      tags: JSON.stringify(['benchmark', ...tags, task.name, ...(task.tags ?? [])]),
    },
  });
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
    if (signal?.aborted) return { status: 'cancelled', error: 'Run cancelled' };
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
  return prisma.taskDiff.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' } });
}

async function getAgentRunData(prisma: PrismaClient, taskId: string) {
  return prisma.agentRun.findFirst({ where: { taskId }, orderBy: { createdAt: 'desc' } });
}

function buildEvalContext(
  agentRun: Awaited<ReturnType<typeof getAgentRunData>>,
  diffs: Awaited<ReturnType<typeof getTaskDiffs>>,
  projectPath: string,
  projectId: string,
  taskId: string,
) {
  return {
    apiUrl: '',
    taskId,
    projectPath,
    projectId,
    agentRun: agentRun ? {
      id: agentRun.id,
      resultStatus: agentRun.resultStatus,
      totalTokens: agentRun.totalTokens ?? undefined,
      costUsd: agentRun.costUsd ?? undefined,
      createdAt: agentRun.createdAt.toISOString(),
      updatedAt: agentRun.updatedAt.toISOString(),
    } : undefined,
    diffs: diffs.map((d) => ({ id: d.id, branch: d.branch, patch: d.patch })),
  };
}

// ─── Single-model strategy ───────────────────────────────────────────────────

async function runSingleTask(
  prisma: PrismaClient,
  task: BenchmarkTask,
  projectPath: string,
  projectPrefix: string,
  model: { provider: string; model: string } | undefined,
  timeoutMs: number,
  tokenBudget: number | undefined,
  signal: AbortSignal,
): Promise<{ harnessTaskId: string; evaluation: BenchmarkEvaluation; durationMs: number; model?: string; costUsd: number; totalTokens: number }> {
  const start = Date.now();
  const projectId = await ensureProject(prisma, `${projectPrefix}-${task.id}`, projectPath);
  const harnessTaskId = await createHarnessTask(prisma, projectId, task, model);
  const modelUsed = model ? `${model.provider}/${model.model}` : undefined;

  await runTask(prisma, harnessTaskId, { tokenBudget });
  const finished = await waitForTaskCompletion(prisma, harnessTaskId, timeoutMs, signal);

  const agentRun = await getAgentRunData(prisma, harnessTaskId);
  const diffs = await getTaskDiffs(prisma, harnessTaskId);
  const evaluation = await task.evaluate(buildEvalContext(agentRun, diffs, projectPath, projectId, harnessTaskId));

  return {
    harnessTaskId,
    evaluation,
    durationMs: Date.now() - start,
    model: modelUsed,
    costUsd: agentRun?.costUsd ?? 0,
    totalTokens: agentRun?.totalTokens ?? 0,
  };
}

// ─── Consensus strategy ──────────────────────────────────────────────────────

async function runConsensusTask(
  prisma: PrismaClient,
  task: BenchmarkTask,
  projectPath: string,
  projectPrefix: string,
  models: Array<{ provider: string; model: string }>,
  timeoutMs: number,
  tokenBudget: number | undefined,
  signal: AbortSignal,
): Promise<{
  harnessTaskId: string;
  evaluation: BenchmarkEvaluation;
  durationMs: number;
  winnerModel?: string;
  costUsd: number;
  totalTokens: number;
}> {
  const start = Date.now();
  const projectId = await ensureProject(prisma, `${projectPrefix}-${task.id}`, projectPath);
  const baseCommit = getBaseCommit(projectPath);

  // Run all models in parallel
  const runs = models.map(async (model) => {
    const harnessTaskId = await createHarnessTask(prisma, projectId, task, model, [`consensus:${model.provider}/${model.model}`]);
    await runTask(prisma, harnessTaskId, { tokenBudget });
    const finished = await waitForTaskCompletion(prisma, harnessTaskId, timeoutMs, signal);
    const agentRun = await getAgentRunData(prisma, harnessTaskId);
    const diffs = await getTaskDiffs(prisma, harnessTaskId);
    const patch = diffs.find((d) => d.patch?.length > 0)?.patch;
    return {
      model,
      harnessTaskId,
      status: finished.status,
      patch: patch ?? '',
      patchBytes: patch?.length ?? 0,
      costUsd: agentRun?.costUsd ?? 0,
      totalTokens: agentRun?.totalTokens ?? 0,
    };
  });

  const candidates = await Promise.all(runs);

  // Sort by patch size (smallest first — better signal)
  const withPatch = candidates.filter((c) => c.patchBytes > 0).sort((a, b) => a.patchBytes - b.patchBytes);
  const withoutPatch = candidates.filter((c) => c.patchBytes === 0);

  // Try each candidate's patch on a clean checkout, smallest first
  let winner: typeof candidates[0] | undefined;
  for (const candidate of [...withPatch, ...withoutPatch]) {
    if (signal.aborted) break;
    resetToCommit(projectPath, baseCommit);
    if (!candidate.patch) continue;
    if (!tryGitApply(projectPath, candidate.patch)) continue;

    const agentRun = await getAgentRunData(prisma, candidate.harnessTaskId);
    const diffs = await getTaskDiffs(prisma, candidate.harnessTaskId);
    const evaluation = await task.evaluate(buildEvalContext(agentRun, diffs, projectPath, projectId, candidate.harnessTaskId));

    if (evaluation.passed) {
      winner = candidate;
      break;
    }
  }

  // Reset to base commit after evaluation
  resetToCommit(projectPath, baseCommit);

  const totalCost = candidates.reduce((s, c) => s + c.costUsd, 0);
  const totalTokens = candidates.reduce((s, c) => s + c.totalTokens, 0);

  if (winner) {
    return {
      harnessTaskId: winner.harnessTaskId,
      evaluation: { passed: true, message: `winner: ${winner.model.provider}/${winner.model.model}` },
      durationMs: Date.now() - start,
      winnerModel: `${winner.model.provider}/${winner.model.model}`,
      costUsd: totalCost,
      totalTokens,
    };
  }

  return {
    harnessTaskId: candidates[0]?.harnessTaskId ?? '',
    evaluation: { passed: false, message: 'no candidate passed eval' },
    durationMs: Date.now() - start,
    costUsd: totalCost,
    totalTokens,
  };
}

// ─── Variance strategy ───────────────────────────────────────────────────────

async function runVarianceTask(
  prisma: PrismaClient,
  task: BenchmarkTask,
  projectPath: string,
  projectPrefix: string,
  model: { provider: string; model: string } | undefined,
  nRuns: number,
  timeoutMs: number,
  tokenBudget: number | undefined,
  signal: AbortSignal,
): Promise<{
  harnessTaskId: string;
  evaluation: BenchmarkEvaluation;
  durationMs: number;
  model?: string;
  variancePassRate: number;
  costUsd: number;
  totalTokens: number;
}> {
  const start = Date.now();
  const modelUsed = model ? `${model.provider}/${model.model}` : undefined;
  let passes = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let lastHarnessTaskId = '';

  for (let run = 0; run < nRuns; run++) {
    if (signal.aborted) break;
    const runProjectPath = path.join(projectPath, `run-${run}`);
    await fs.mkdir(runProjectPath, { recursive: true });
    // Copy the base project files by using the task's setup function again
    if (task.setup) await task.setup(runProjectPath);
    ensureGitRepo(runProjectPath);

    const result = await runSingleTask(prisma, task, runProjectPath, `${projectPrefix}-${task.id}`, model, timeoutMs, tokenBudget, signal);
    lastHarnessTaskId = result.harnessTaskId;
    if (result.evaluation.passed) passes++;
    totalCost += result.costUsd;
    totalTokens += result.totalTokens;
  }

  const passRate = nRuns > 0 ? passes / nRuns : 0;

  return {
    harnessTaskId: lastHarnessTaskId,
    evaluation: { passed: passRate >= 0.5, message: `${passes}/${nRuns} passed (${(passRate * 100).toFixed(0)}%)`, metrics: { passRate, passes, nRuns } },
    durationMs: Date.now() - start,
    model: modelUsed,
    variancePassRate: passRate,
    costUsd: totalCost,
    totalTokens,
  };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

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

    emitter.emit('run', { type: 'started', runId, suite: config.suite } satisfies BenchRunEvent);

    const tasks = await loadSuite(config.suite, { nTasks: config.nTasks, taskIds: config.taskIds });

    if (tasks.length === 0) {
      await prisma.benchmarkRun.update({ where: { id: runId }, data: { status: 'done', completedAt: new Date(), totalTasks: 0 } });
      emitter.emit('run', { type: 'completed', runId, summary: { total: 0, passed: 0, failed: 0, timeouts: 0, totalDurationMs: 0 } } satisfies BenchRunEvent);
      return;
    }

    await prisma.benchmarkRun.update({ where: { id: runId }, data: { totalTasks: tasks.length } });

    const timeoutMs = config.timeoutMs ?? 600_000;
    const projectPrefix = config.projectPrefix ?? 'bench';
    const baseDir = path.join(omegaWorkDir(), 'bench', runId);
    await fs.mkdir(baseDir, { recursive: true });

    const strategy = config.strategy ?? 'single';
    const models = config.models ?? [];
    const varianceRuns = config.varianceRuns ?? 5;

    let passed = 0;
    let failed = 0;
    let timeouts = 0;
    let totalDurationMs = 0;
    let totalCostUsd = 0;
    let totalTokens = 0;
    const winsByModel: Record<string, number> = {};
    const results: Array<{
      taskName: string;
      harnessTaskId: string;
      passed: boolean;
      durationMs: number;
      model?: string;
      winnerModel?: string;
      variancePassRate?: number;
      error?: string;
    }> = [];

    for (const task of tasks) {
      if (abortController.signal.aborted) break;

      const projectPath = path.join(baseDir, task.id);
      await fs.mkdir(projectPath, { recursive: true });
      if (task.setup) await task.setup(projectPath);
      ensureGitRepo(projectPath);

      emitter.emit('run', {
        type: 'task-started',
        runId,
        taskName: task.name,
        model: strategy === 'consensus' ? models.map((m) => m.model).join('+') : models[0] ? `${models[0].provider}/${models[0].model}` : undefined,
      } satisfies BenchRunEvent);

      let result: Awaited<ReturnType<typeof runSingleTask>> & { winnerModel?: string; variancePassRate?: number };

      try {
        if (strategy === 'consensus' && models.length > 1) {
          result = await runConsensusTask(prisma, task, projectPath, projectPrefix, models, timeoutMs, config.tokenBudget, abortController.signal);
        } else if (strategy === 'variance') {
          result = await runVarianceTask(prisma, task, projectPath, projectPrefix, models[0], varianceRuns, timeoutMs, config.tokenBudget, abortController.signal);
        } else {
          result = await runSingleTask(prisma, task, projectPath, projectPrefix, models[0], timeoutMs, config.tokenBudget, abortController.signal);
        }
      } catch (err) {
        result = {
          harnessTaskId: '',
          evaluation: { passed: false, message: err instanceof Error ? err.message : String(err) },
          durationMs: 0,
          costUsd: 0,
          totalTokens: 0,
        };
      }

      if (result.evaluation.passed) passed++;
      else if (result.durationMs >= timeoutMs - 5000) timeouts++;
      else failed++;

      totalDurationMs += result.durationMs;
      totalCostUsd += result.costUsd;
      totalTokens += result.totalTokens;

      if (result.winnerModel) {
        winsByModel[result.winnerModel] = (winsByModel[result.winnerModel] ?? 0) + 1;
      }

      results.push({
        taskName: task.name,
        harnessTaskId: result.harnessTaskId,
        passed: result.evaluation.passed,
        durationMs: result.durationMs,
        model: result.model,
        winnerModel: result.winnerModel,
        variancePassRate: result.variancePassRate,
        error: result.evaluation.passed ? undefined : result.evaluation.message,
      });

      emitter.emit('run', {
        type: 'task-completed',
        runId,
        taskId: result.harnessTaskId,
        taskName: task.name,
        model: result.model,
        passed: result.evaluation.passed,
        durationMs: result.durationMs,
        winnerModel: result.winnerModel,
        variancePassRate: result.variancePassRate,
      } satisfies BenchRunEvent);

      await prisma.benchmarkRun.update({
        where: { id: runId },
        data: { passed, failed, timeouts, totalDurationMs, totalCostUsd, totalTokens },
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
      results: results.map((r) => {
        const metrics: Record<string, string | number> = {};
        if (r.winnerModel) metrics.winnerModel = r.winnerModel;
        if (r.variancePassRate != null) metrics.passRate = r.variancePassRate;
        return {
          task: tasks.find((t) => t.name === r.taskName) ?? { id: r.taskName, name: r.taskName, title: r.taskName, evaluate: () => ({ passed: false }) },
          harnessTaskId: r.harnessTaskId,
          durationMs: r.durationMs,
          status: r.passed ? 'done' as const : 'failed' as const,
          evaluation: { passed: r.passed, message: r.error ?? (r.winnerModel ? `winner: ${r.winnerModel}` : undefined), metrics: Object.keys(metrics).length > 0 ? metrics : undefined },
          spanCount: 0,
        };
      }),
    };

    try {
      await saveBenchmarkHistory(prisma, report, {
        provider: strategy === 'consensus' ? 'consensus' : models[0]?.provider,
        model: strategy === 'consensus' ? models.map((m) => m.model).join('+') : models[0]?.model,
        metadata: strategy === 'consensus' ? { winsByModel } : undefined,
      });
    } catch { /* best-effort */ }

    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: { status: 'done', completedAt: new Date(), results: JSON.stringify(results) },
    });

    emitter.emit('run', {
      type: 'completed',
      runId,
      summary: { total: tasks.length, passed, failed, timeouts, totalDurationMs, winsByModel: Object.keys(winsByModel).length > 0 ? winsByModel : undefined },
    } satisfies BenchRunEvent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.benchmarkRun.update({ where: { id: runId }, data: { status: 'failed', error: message, completedAt: new Date() } });
    emitter.emit('run', { type: 'failed', runId, error: message } satisfies BenchRunEvent);
  } finally {
    activeRuns.delete(runId);
  }
}
