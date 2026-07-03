import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { BenchmarkReport, BenchmarkResult, BenchmarkTask, BenchmarkEvaluation, TraceFlowInfo } from './types.js';
import {
  ensureProject,
  createTask,
  runTask,
  waitForTask,
  getAgentRun,
  getDiffs,
  getTraceFlow,
  countSpans,
} from './api-client.js';

export interface RunnerOptions {
  apiUrl: string;
  suiteName: string;
  timeoutMs?: number;
  projectPrefix?: string;
  onProgress?: (result: BenchmarkResult) => void;
}

function countAllSpans(traceFlow?: TraceFlowInfo): number {
  if (!traceFlow) return 0;
  return traceFlow.spans.reduce((acc, span) => acc + countSpans(span), 0);
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

export async function runBenchmark(
  tasks: BenchmarkTask[],
  options: RunnerOptions
): Promise<BenchmarkReport> {
  const { apiUrl, suiteName, timeoutMs = 120000, projectPrefix = 'bench' } = options;
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    suite: suiteName,
    total: tasks.length,
    passed: 0,
    failed: 0,
    timeouts: 0,
    totalDurationMs: 0,
    results: [],
  };

  const baseDir = path.join('/tmp', `omega-bench-${String(Date.now())}`);
  await fs.mkdir(baseDir, { recursive: true });

  for (const task of tasks) {
    const start = Date.now();
    let harnessTaskId = '';
    let status: BenchmarkResult['status'] = 'failed';
    let agentRun;
    let diffs: Awaited<ReturnType<typeof getDiffs>> = [];
    let traceFlow;
    let evaluation: BenchmarkEvaluation = { passed: false, message: 'Task did not complete' };
    let projectId = '';
    let projectPath = '';

    try {
      projectPath = path.join(baseDir, task.id);
      await fs.mkdir(projectPath, { recursive: true });
      if (task.setup) {
        await task.setup(projectPath);
      }
      ensureGitRepo(projectPath);

      const project = await ensureProject(apiUrl, `${projectPrefix}-${task.id}`, projectPath);
      projectId = project.id;
      const harnessTask = await createTask(apiUrl, project.id, task.title, {
        description: task.description,
        complexity: task.complexity ?? 'simple',
        tags: ['benchmark', 'agent'],
      });
      harnessTaskId = harnessTask.id;

      await runTask(apiUrl, harnessTask.id);
      const finished = await waitForTask(apiUrl, harnessTask.id, timeoutMs);
      status = finished.status === 'timeout' ? 'timeout' : (finished.status as BenchmarkResult['status']);

      [agentRun, diffs, traceFlow] = await Promise.all([
        getAgentRun(apiUrl, harnessTask.id),
        getDiffs(apiUrl, harnessTask.id),
        getTraceFlow(apiUrl, harnessTask.id),
      ]);

      evaluation = await task.evaluate({
        apiUrl,
        taskId: harnessTask.id,
        projectPath,
        projectId,
        agentRun,
        diffs,
        traceFlow,
      });
    } catch (err) {
      evaluation = {
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - start;
    const result: BenchmarkResult = {
      task,
      harnessTaskId,
      durationMs,
      status,
      evaluation,
      agentRun,
      spanCount: countAllSpans(traceFlow),
    };

    if (status === 'timeout') report.timeouts++;
    else if (evaluation.passed) report.passed++;
    else report.failed++;

    report.totalDurationMs += durationMs;
    report.results.push(result);
    options.onProgress?.(result);
  }

  return report;
}
