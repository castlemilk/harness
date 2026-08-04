import fs from 'node:fs/promises';
import path from 'node:path';
import { omegaWorkDir } from '@omega/core';
import type { BenchmarkReport, BenchmarkResult, BenchmarkTask, BenchmarkEvaluation, TraceFlowInfo } from './types.js';
import { classifyFailure } from './analyse.js';
import {
  ensureProject,
  createTask,
  runTask,
  waitForTask,
  getAgentRun,
  getDiffs,
  pollForDiffs,
  getTraceFlow,
  getTraceSummary,
  getPromptVersion,
  countSpans,
  withRetry,
} from './api-client.js';
import { ensureGitRepo } from './git-utils.js';

export interface RunnerOptions {
  apiUrl: string;
  suiteName: string;
  timeoutMs?: number;
  projectPrefix?: string;
  provider?: string;
  model?: string;
  tokenBudget?: number;
  /** Run tasks via an external coding-agent CLI (e.g. codex, claude-code) instead of an internal model. */
  externalCli?: string;
  onProgress?: (result: BenchmarkResult) => void;
}

function countAllSpans(traceFlow?: TraceFlowInfo): number {
  if (!traceFlow) return 0;
  return traceFlow.spans.reduce((acc, span) => acc + countSpans(span), 0);
}

// The server performs setup (clone, venv, worktree) before the agent's own
// wall-clock deadline starts, so runTask's 202 lands minutes before the agent
// actually begins. Buffer the CLI wait by this much so it outlasts the agent's
// deadline: without it, a timed-out run reports 0 patches because the diff is
// committed after pollForDiffs' grace window has already closed.
const SETUP_BUFFER_MS = 10 * 60 * 1000;

export async function runBenchmark(
  tasks: BenchmarkTask[],
  options: RunnerOptions
): Promise<BenchmarkReport> {
  const { apiUrl, suiteName, timeoutMs = 1800000, projectPrefix = 'bench' } = options;
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

  const baseDir = path.join(omegaWorkDir(), 'bench', String(Date.now()));
  await fs.mkdir(baseDir, { recursive: true });

  for (const task of tasks) {
    const start = Date.now();
    let harnessTaskId = '';
    let status: BenchmarkResult['status'] = 'failed';
    let agentRun;
    let diffs: Awaited<ReturnType<typeof getDiffs>> = [];
    let traceFlow;
    let traceSummary;
    let evaluation: BenchmarkEvaluation = { passed: false, message: 'Task did not complete' };
    let taskError: string | undefined;
    let projectId = '';
    let projectPath = '';
    let promptVersion: Awaited<ReturnType<typeof getPromptVersion>> = undefined;

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
        tags: options.externalCli
          ? ['benchmark', `external:${options.externalCli}`, task.name, ...(task.tags ?? [])]
          : ['benchmark', 'agent', task.name, ...(task.tags ?? [])],
      });
      harnessTaskId = harnessTask.id;

      if (!options.externalCli && (options.provider || options.model)) {
        await withRetry(() =>
          fetch(`${apiUrl}/tasks/${harnessTaskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: options.provider, model: options.model }),
          }),
        );
      }

      await runTask(apiUrl, harnessTask.id, options.tokenBudget);
      const finished = await waitForTask(apiUrl, harnessTask.id, timeoutMs + SETUP_BUFFER_MS);
      taskError = finished.error;
      status = finished.status === 'timeout' ? 'timeout' : (finished.status as BenchmarkResult['status']);

      // On timeout, give the agent up to 3 more minutes to finish and commit
      // its model.patch to the DB before we read the diffs. Without this, the
      // bench reports 0 patches on every timed-out complex task.
      const diffsPromise =
        finished.status === 'timeout'
          ? pollForDiffs(apiUrl, harnessTask.id)
          : getDiffs(apiUrl, harnessTask.id);

      [agentRun, diffs, traceFlow, traceSummary] = await Promise.all([
        getAgentRun(apiUrl, harnessTask.id),
        diffsPromise,
        getTraceFlow(apiUrl, harnessTask.id),
        getTraceSummary(apiUrl, harnessTask.id),
      ]);

      if (agentRun?.promptVersionId) {
        promptVersion = await getPromptVersion(apiUrl, agentRun.promptVersionId);
      }

      evaluation = await task.evaluate({
        apiUrl,
        taskId: harnessTask.id,
        projectPath,
        projectId,
        agentRun,
        diffs,
        traceFlow,
        traceSummary,
      });
    } catch (err) {
      const thrownMessage = err instanceof Error ? err.message : String(err);
      evaluation = {
        passed: false,
        message: taskError && !taskError.startsWith('fetch failed') ? taskError : thrownMessage,
      };
    }

    if (!evaluation.message && taskError) {
      evaluation = { ...evaluation, message: taskError };
    }

    const durationMs = Date.now() - start;
    const result: BenchmarkResult = {
      task,
      harnessTaskId,
      durationMs,
      status,
      taskError,
      evaluation,
      agentRun,
      diffs,
      spanCount: countAllSpans(traceFlow),
      traceSummary,
      promptVersionId: agentRun?.promptVersionId,
      promptHash: promptVersion?.hash,
    };

    if (!evaluation.passed) {
      result.failureAnalysis = classifyFailure(result, traceFlow);
    }

    if (status === 'timeout') report.timeouts++;
    else if (evaluation.passed) report.passed++;
    else report.failed++;

    report.totalDurationMs += durationMs;
    report.results.push(result);
    options.onProgress?.(result);
  }

  if (report.results.length > 0) {
    const latestResult = report.results[report.results.length - 1];
    report.promptVersionId = latestResult.promptVersionId;
    report.promptHash = latestResult.promptHash;
  }

  return report;
}
