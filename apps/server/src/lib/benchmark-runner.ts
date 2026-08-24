import fs from 'node:fs/promises';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { EventEmitter } from 'node:events';
import { execSync, execFileSync } from 'node:child_process';
import { omegaWorkDir } from '@omega/core';
import type { PrismaClient } from '@omega/db';
import type { BenchmarkTask, BenchmarkReport, BenchmarkEvaluation } from '@omega/bench';
import {
  BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS,
  saveBenchmarkHistory,
} from '@omega/bench';
import { runTask } from './run-task.js';

export interface BenchRunConfig {
  suite: string;
  models?: { provider: string; model: string }[];
  strategy?: 'single' | 'consensus' | 'variance';
  concurrency?: number;
  timeoutMs?: number;
  tokenBudget?: number;
  projectPrefix?: string;
  nTasks?: number;
  taskIds?: string[];
  /** For variance mode: number of runs per task. */
  varianceRuns?: number;
  /** SWE-bench adapter options (when suite is 'swebench-lite'). */
  swebench?: { datasetPath?: string; repos?: string[]; sampleSeed?: number };
  /** DeepSWE adapter options (when suite is 'deepswe'). */
  deepswe?: { tasksDir: string; taskIds?: string[]; useDocker?: boolean };
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
  /** Full per-task evaluator output, including adapter-specific metrics. */
  evaluation?: BenchmarkEvaluation;
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
    writeFileSync(tmp, patch.endsWith('\n') ? patch : `${patch}\n`);
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
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ─── Suite loading ───────────────────────────────────────────────────────────

async function loadSuite(
  suite: string,
  options: { nTasks?: number; taskIds?: string[]; timeoutMs?: number; swebench?: BenchRunConfig['swebench']; deepswe?: BenchRunConfig['deepswe'] } = {},
): Promise<BenchmarkTask[]> {
  let tasks: BenchmarkTask[];

  if (suite === 'swebench-lite') {
    const { loadSWebenchLiteSuite } = await import('@omega/bench');
    tasks = await loadSWebenchLiteSuite({
      datasetPath: options.swebench?.datasetPath ?? '/tmp/swe-bench-lite-test.json',
      repos: options.swebench?.repos,
      sampleSeed: options.swebench?.sampleSeed,
      nTasks: options.nTasks,
      taskIds: options.taskIds,
    });
  } else if (suite === 'deepswe') {
    const { loadDeepSWESuite } = await import('@omega/bench');
    if (!options.deepswe?.tasksDir) throw new Error('deepswe.tasksDir is required');
    tasks = await loadDeepSWESuite({
      tasksDir: options.deepswe.tasksDir,
      nTasks: options.nTasks,
      // The schema accepts ids in BOTH places; honouring only the top-level
      // one made `deepswe.taskIds` validate cleanly and then silently launch
      // the whole 113-task suite. Nested wins — it is the more specific ask.
      taskIds: options.deepswe.taskIds ?? options.taskIds,
      useDocker: options.deepswe.useDocker,
      timeoutMs: options.timeoutMs,
    });
  } else {
    const {
      syntheticSuite,
      fastSuite,
      harderSuite,
      harderV2Suite,
      hardTargetedSuite,
    } = await import('@omega/bench');

    switch (suite) {
      case 'synthetic': tasks = syntheticSuite(); break;
      case 'fast': tasks = fastSuite(); break;
      case 'harder': tasks = harderSuite(); break;
      case 'harder-v2': tasks = harderV2Suite(); break;
      case 'hard-targeting': tasks = hardTargetedSuite(); break;
      default: throw new Error(`Unknown suite: ${suite}`);
    }

    if (options.taskIds && options.taskIds.length > 0) {
      const ids = options.taskIds;
      tasks = tasks.filter((t) => ids.includes(t.id));
    }
    if (options.nTasks && options.nTasks > 0) {
      tasks = tasks.slice(0, options.nTasks);
    }
  }

  return tasks;
}

// ─── Harness task helpers ────────────────────────────────────────────────────

async function ensureProject(prisma: PrismaClient, name: string, projectPath: string): Promise<string> {
  let project = await prisma.project.findFirst({ where: { path: projectPath } });
  project ??= await prisma.project.create({ data: { name, path: projectPath } });
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
      // A model config of provider `external:<cli>` routes the task through
      // that coding-agent CLI: the provider string IS run-task's external tag,
      // and Task.model (set below) is the model the CLI is asked to run.
      tags: JSON.stringify([
        'benchmark',
        'agent',
        ...(model?.provider.startsWith('external:') ? [model.provider] : []),
        ...tags,
        task.name,
        ...(task.tags ?? []),
      ]),
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
      validationSummary: agentRun.validationSummary ?? undefined,
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

  await runTask(prisma, harnessTaskId, { tokenBudget, timeoutMs, signal });
  const completion = await waitForTaskCompletion(prisma, harnessTaskId, timeoutMs, signal);
  if (completion.status === 'cancelled') {
    throw new Error(completion.error ?? 'Run cancelled');
  }

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
  models: { provider: string; model: string }[],
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
    await runTask(prisma, harnessTaskId, { tokenBudget, timeoutMs, signal });
    const finished = await waitForTaskCompletion(prisma, harnessTaskId, timeoutMs, signal);
    const agentRun = await getAgentRunData(prisma, harnessTaskId);
    const diffs = await getTaskDiffs(prisma, harnessTaskId);
    const patch = diffs.find((d) => d.patch.length > 0)?.patch;
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
  let selectedCandidate: typeof candidates[0] | undefined;
  let selectedEvaluation: BenchmarkEvaluation | undefined;
  for (const candidate of [...withPatch, ...withoutPatch]) {
    if (signal.aborted) break;
    resetToCommit(projectPath, baseCommit);
    if (!candidate.patch) continue;
    if (!tryGitApply(projectPath, candidate.patch)) continue;

    const agentRun = await getAgentRunData(prisma, candidate.harnessTaskId);
    const diffs = await getTaskDiffs(prisma, candidate.harnessTaskId);
    const evaluation = await task.evaluate(buildEvalContext(agentRun, diffs, projectPath, projectId, candidate.harnessTaskId));
    selectedCandidate = candidate;
    selectedEvaluation = evaluation;

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
      evaluation: selectedEvaluation ?? { passed: true, message: `winner: ${winner.model.provider}/${winner.model.model}` },
      durationMs: Date.now() - start,
      winnerModel: `${winner.model.provider}/${winner.model.model}`,
      costUsd: totalCost,
      totalTokens,
    };
  }

  return {
    harnessTaskId: selectedCandidate?.harnessTaskId ?? candidates.at(0)?.harnessTaskId ?? '',
    evaluation: selectedEvaluation ?? { passed: false, message: 'no candidate passed eval' },
    durationMs: Date.now() - start,
    costUsd: totalCost,
    totalTokens,
  };
}

// ─── Variance strategy ───────────────────────────────────────────────────────

const VARIANCE_OUTCOME_ERROR_MAX_CHARS = 512;
const VARIANCE_OUTCOME_TASK_ID_MAX_CHARS = 128;

export interface VarianceRunOutcome {
  run: number;
  harnessTaskId: string;
  passed: boolean;
  score?: number;
  durationMs: number;
  metrics?: Record<string, number | string>;
  error?: string;
  cancelled?: boolean;
  omittedRuns?: number;
}

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function numericMetrics(
  metrics: BenchmarkEvaluation['metrics'],
): Record<string, number> | undefined {
  if (!metrics) return undefined;
  const compact = Object.fromEntries(
    Object.entries(metrics).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  ) as Record<string, number>;
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactVarianceOutcome(outcome: VarianceRunOutcome): VarianceRunOutcome {
  return {
    run: outcome.run,
    harnessTaskId: outcome.harnessTaskId.slice(0, VARIANCE_OUTCOME_TASK_ID_MAX_CHARS),
    passed: outcome.passed,
    score: outcome.score,
    durationMs: outcome.durationMs,
    metrics: numericMetrics(outcome.metrics),
    error: outcome.error?.slice(0, VARIANCE_OUTCOME_ERROR_MAX_CHARS),
    cancelled: outcome.cancelled,
    omittedRuns: outcome.omittedRuns,
  };
}

/**
 * Keep the scalar `variance_run_outcomes` metric valid JSON under history's
 * generic string budget. Numeric metrics survive; string output blobs do not.
 * If core outcomes alone exceed the budget, retain the newest ordered suffix
 * plus a structured count of the older outcomes that were omitted.
 */
export function serializeVarianceRunOutcomes(outcomes: VarianceRunOutcome[]): string {
  const compact = outcomes.map(compactVarianceOutcome);
  const full = JSON.stringify(compact);
  if (full.length <= BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS) return full;

  for (let omittedRuns = 1; omittedRuns < compact.length; omittedRuns++) {
    const sentinel: VarianceRunOutcome = {
      run: compact[omittedRuns]?.run ?? omittedRuns + 1,
      harnessTaskId: '',
      passed: false,
      durationMs: 0,
      omittedRuns,
    };
    const candidate = JSON.stringify([sentinel, ...compact.slice(omittedRuns)]);
    if (candidate.length <= BENCHMARK_HISTORY_STRING_METRIC_MAX_CHARS) return candidate;
  }

  return JSON.stringify([{
    run: compact.at(-1)?.run ?? 0,
    harnessTaskId: '',
    passed: false,
    durationMs: 0,
    omittedRuns: compact.length,
  } satisfies VarianceRunOutcome]);
}

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
  timedOut: boolean;
  costUsd: number;
  totalTokens: number;
}> {
  const start = Date.now();
  const modelUsed = model ? `${model.provider}/${model.model}` : undefined;
  let passes = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let lastHarnessTaskId = '';
  let lastEvaluation: BenchmarkEvaluation | undefined;
  const runOutcomes: VarianceRunOutcome[] = [];

  for (let run = 0; run < nRuns; run++) {
    if (signal.aborted) {
      runOutcomes.push({
        run: run + 1,
        harnessTaskId: '',
        passed: false,
        durationMs: 0,
        error: 'Run cancelled',
        cancelled: true,
      });
      break;
    }
    const runStartedAt = Date.now();
    const runProjectPath = path.join(projectPath, `run-${String(run)}`);
    try {
      await fs.mkdir(runProjectPath, { recursive: true });
      // Copy the base project files by using the task's setup function again
      if (task.setup) await task.setup(runProjectPath);
      ensureGitRepo(runProjectPath);

      const result = await runSingleTask(prisma, task, runProjectPath, `${projectPrefix}-${task.id}`, model, timeoutMs, tokenBudget, signal);
      lastHarnessTaskId = result.harnessTaskId;
      lastEvaluation = result.evaluation;
      runOutcomes.push({
        run: run + 1,
        harnessTaskId: result.harnessTaskId,
        passed: result.evaluation.passed,
        score: result.evaluation.score,
        durationMs: result.durationMs,
        metrics: numericMetrics(result.evaluation.metrics),
      });
      if (result.evaluation.passed) passes++;
      totalCost += result.costUsd;
      totalTokens += result.totalTokens;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The signal can change during any awaited setup/agent operation above;
      // keep this runtime read out of TypeScript's stale loop narrowing.
      const cancelled = signalIsAborted(signal);
      runOutcomes.push({
        run: run + 1,
        harnessTaskId: '',
        passed: false,
        durationMs: Date.now() - runStartedAt,
        error: cancelled ? 'Run cancelled' : message.slice(0, VARIANCE_OUTCOME_ERROR_MAX_CHARS),
        cancelled: cancelled || undefined,
      });
      // Preserve completed outcomes, but stop after a potentially terminal
      // setup/provider failure instead of multiplying it across repetitions.
      break;
    }
  }

  const cancelledRuns = runOutcomes.filter((outcome) => outcome.cancelled).length;
  const completedRuns = runOutcomes.length - cancelledRuns;
  // Keep the historical passRate denominator and verdict semantics: requested
  // repetitions that do not complete still count against the aggregate.
  const passRate = nRuns > 0 ? passes / nRuns : 0;
  const completedPassRate = completedRuns > 0 ? passes / completedRuns : 0;
  const incomplete = completedRuns < nRuns;
  const attemptTimeoutThreshold = Math.max(0, timeoutMs - 5_000);
  const timedOut = runOutcomes.some(
    (outcome) => !outcome.cancelled && outcome.durationMs >= attemptTimeoutThreshold,
  );

  return {
    harnessTaskId: lastHarnessTaskId,
    evaluation: {
      passed: passRate >= 0.5,
      score: lastEvaluation?.score,
      message: `${String(passes)}/${String(nRuns)} passed (${(passRate * 100).toFixed(0)}%)${incomplete ? `; ${String(completedRuns)}/${String(nRuns)} runs completed` : ''}${cancelledRuns > 0 ? '; cancelled' : ''}`,
      metrics: {
        ...lastEvaluation?.metrics,
        passRate,
        completedPassRate,
        passes,
        nRuns,
        completedRuns,
        variance_incomplete: incomplete ? 1 : 0,
        variance_cancelled: cancelledRuns > 0 ? 1 : 0,
        // BenchmarkEvaluation metrics are scalar values, so retain compact,
        // ordered run outcomes as JSON without copying full logs/messages.
        variance_run_outcomes: serializeVarianceRunOutcomes(runOutcomes),
      },
    },
    durationMs: Date.now() - start,
    model: modelUsed,
    variancePassRate: passRate,
    timedOut,
    costUsd: totalCost,
    totalTokens,
  };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

const BENCHMARK_PROGRESS_TEXT_MAX_CHARS = 512;

function compactProgressResult<
  T extends { evaluation: BenchmarkEvaluation; error?: string },
>(result: T): T {
  return {
    ...result,
    error: result.error?.slice(0, BENCHMARK_PROGRESS_TEXT_MAX_CHARS),
    evaluation: {
      passed: result.evaluation.passed,
      score: result.evaluation.score,
      message: result.evaluation.message?.slice(0, BENCHMARK_PROGRESS_TEXT_MAX_CHARS),
      metrics: numericMetrics(result.evaluation.metrics),
    },
  };
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

    emitter.emit('run', { type: 'started', runId, suite: config.suite } satisfies BenchRunEvent);

    const timeoutMs = config.timeoutMs ?? 600_000;
    const tasks = await loadSuite(config.suite, {
      nTasks: config.nTasks,
      taskIds: config.taskIds,
      timeoutMs,
      swebench: config.swebench,
      deepswe: config.deepswe,
    });

    if (tasks.length === 0) {
      const status = abortController.signal.aborted ? 'cancelled' : 'done';
      await prisma.benchmarkRun.update({ where: { id: runId }, data: { status, completedAt: new Date(), totalTasks: 0 } });
      emitter.emit('run', { type: 'completed', runId, status, summary: { total: 0, passed: 0, failed: 0, timeouts: 0, totalDurationMs: 0 } } satisfies BenchRunEvent);
      return;
    }

    await prisma.benchmarkRun.update({ where: { id: runId }, data: { totalTasks: tasks.length } });

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
    const results: {
      taskName: string;
      harnessTaskId: string;
      passed: boolean;
      durationMs: number;
      evaluation: BenchmarkEvaluation;
      costUsd: number;
      totalTokens: number;
      model?: string;
      winnerModel?: string;
      variancePassRate?: number;
      error?: string;
    }[] = [];

    // Concurrency pool — run up to `concurrency` tasks in parallel
    const concurrency = config.concurrency ?? 1;
    let running = 0;
    let taskIdx = 0;
    let resolveAll: (() => void) | undefined;
    const allDone = new Promise<void>((r) => { resolveAll = r; });

    const launchNext = () => {
      if (abortController.signal.aborted || taskIdx >= tasks.length) {
        if (running === 0) resolveAll?.();
        return;
      }
      const idx = taskIdx++;
      const task = tasks[idx];
      running++;

      void (async () => {
        const projectPath = path.join(baseDir, task.id);

        emitter.emit('run', {
          type: 'task-started',
          runId,
          taskName: task.name,
          model: strategy === 'consensus' ? models.map((m) => m.model).join('+') : models[0] ? `${models[0].provider}/${models[0].model}` : undefined,
        } satisfies BenchRunEvent);

        let result: Awaited<ReturnType<typeof runSingleTask>> & { winnerModel?: string; variancePassRate?: number; timedOut?: boolean };

        try {
          // Setup (clone + dependency install) INSIDE the try: a rejection
          // here used to escape the async IIFE entirely — an unhandled
          // rejection that never decremented `running`, so each broken
          // environment leaked a pool slot until the whole run silently
          // wedged (observed live: 4 install failures froze a 113-task run
          // at 58 with zero workers left). A setup failure is a task
          // failure, not a pool leak.
          await fs.mkdir(projectPath, { recursive: true });
          if (task.setup) await task.setup(projectPath);
          ensureGitRepo(projectPath);

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
        else if (result.timedOut ?? result.durationMs >= timeoutMs - 5000) timeouts++;
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
          evaluation: result.evaluation,
          costUsd: result.costUsd,
          totalTokens: result.totalTokens,
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
          evaluation: result.evaluation,
        } satisfies BenchRunEvent);

        try {
          await prisma.benchmarkRun.update({
            where: { id: runId },
            data: {
              passed,
              failed,
              timeouts,
              totalDurationMs,
              totalCostUsd,
              totalTokens,
              results: JSON.stringify(results.map(compactProgressResult)),
            },
          });
        } catch {
          // Live progress is best-effort. The final update below retries the
          // complete snapshot; a transient write must not strand a pool slot.
        }

        running--;
        launchNext();
      })();
    };

    // Fill initial slots
    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
      launchNext();
    }

    await allDone;

    // Save to history
    const reportTimestamp = new Date().toISOString();
    const report: BenchmarkReport = {
      timestamp: reportTimestamp,
      suite: config.suite,
      total: tasks.length,
      passed,
      failed,
      timeouts,
      totalDurationMs,
      totalUsage: { totalTokens },
      results: results.map((r) => {
        const metrics: Record<string, string | number> = { ...r.evaluation.metrics };
        if (r.winnerModel) metrics.winnerModel = r.winnerModel;
        if (r.variancePassRate != null) metrics.passRate = r.variancePassRate;
        return {
          task: tasks.find((t) => t.name === r.taskName) ?? { id: r.taskName, name: r.taskName, title: r.taskName, evaluate: () => ({ passed: false }) },
          harnessTaskId: r.harnessTaskId,
          durationMs: r.durationMs,
          status: r.passed ? 'done' as const : 'failed' as const,
          evaluation: {
            ...r.evaluation,
            metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
          },
          usage: { totalTokens: r.totalTokens },
          agentRun: {
            id: r.harnessTaskId,
            resultStatus: r.passed ? 'done' : 'failed',
            totalTokens: r.totalTokens,
            costUsd: r.costUsd,
            createdAt: reportTimestamp,
            updatedAt: reportTimestamp,
          },
          spanCount: 0,
        };
      }),
    };

    try {
      await saveBenchmarkHistory(prisma, report, {
        provider: strategy === 'consensus' ? 'consensus' : models[0]?.provider,
        model: strategy === 'consensus' ? models.map((m) => m.model).join('+') : models[0]?.model,
        metadata: {
          ...(strategy === 'consensus' ? { winsByModel } : {}),
          results,
        },
      });
    } catch { /* best-effort */ }

    const terminalStatus = abortController.signal.aborted ? 'cancelled' : 'done';
    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: {
        status: terminalStatus,
        completedAt: new Date(),
        passed,
        failed,
        timeouts,
        totalDurationMs,
        totalCostUsd,
        totalTokens,
        results: JSON.stringify(results),
      },
    });

    emitter.emit('run', {
      type: 'completed',
      runId,
      status: terminalStatus,
      summary: { total: tasks.length, passed, failed, timeouts, totalDurationMs, winsByModel: Object.keys(winsByModel).length > 0 ? winsByModel : undefined },
    } satisfies BenchRunEvent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = abortController.signal.aborted ? 'cancelled' : 'failed';
    await prisma.benchmarkRun.update({ where: { id: runId }, data: { status, error: message, completedAt: new Date() } });
    emitter.emit('run', {
      type: status === 'cancelled' ? 'completed' : 'failed',
      runId,
      status,
      error: message,
    } satisfies BenchRunEvent);
  } finally {
    activeRuns.delete(runId);
  }
}
