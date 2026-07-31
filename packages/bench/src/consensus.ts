import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { omegaWorkDir } from '@omega/core';
import type { BenchmarkTask, BenchmarkReport, BenchmarkEvaluation, EvaluationContext, AgentRunInfo } from './types.js';
import {
  ensureProject,
  createTask,
  runTask,
  waitForTask,
  getAgentRun,
  getDiffs,
  pollForDiffs,
} from './api-client.js';
import { ensureGitRepo, resetToCommit } from './git-utils.js';

/**
 * Best-of-N consensus eval: run N agents in parallel on the same task,
 * collect all patches, then evaluate them one-by-one on a clean checkout
 * (smallest patch first as a tie-breaker — smaller diffs tend to be more
 * focused and less likely to break unrelated code). The first patch whose
 * evaluator returns passed=true wins.
 *
 * Pass rate = fraction of tasks where ANY agent produced a passing patch.
 * Cost = sum of tokens/cost across all agents (consensus is expensive).
 *
 * This is the upper bound of what the agent set can achieve — if any one
 * can solve a task, we get the solution. Compared to single-agent eval,
 * consensus trades tokens for pass rate.
 */

export interface ConsensusModel {
  /** Provider ID, e.g. "minimax", "glm", "deepseek", or "external:agy" */
  provider: string;
  /** Model name, e.g. "MiniMax-M3", "glm-5.2", "agy" */
  model: string;
}

export interface ConsensusOptions {
  apiUrl: string;
  models: ConsensusModel[];
  timeoutMs?: number;
  projectPrefix?: string;
  tokenBudget?: number;
  suiteName?: string;
  /** Max parallel agents per task. Defaults to models.length. */
  maxParallel?: number;
  onTaskProgress?: (taskId: string, report: ConsensusTaskReport) => void;
}

export interface ConsensusCandidate {
  provider: string;
  model: string;
  harnessTaskId: string;
  agentRunId?: string;
  patchBytes: number;
  durationMs: number;
  totalTokens: number | null;
  costUsd: number | null;
  evalPassed: boolean | null;
  evalMessage: string;
}

export interface ConsensusTaskReport {
  task: BenchmarkTask;
  passed: boolean;
  durationMs: number;
  winner: ConsensusCandidate | null;
  candidates: ConsensusCandidate[];
  totalTokens: number;
  totalCostUsd: number;
}

export interface ConsensusSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  /** How many tasks each model contributed the winning patch for. */
  winsByModel: Record<string, number>;
}

export interface ConsensusResult {
  provider: string;
  model: string;
  report: BenchmarkReport & { consensus?: ConsensusSummary };
}

interface CandidateRun {
  provider: string;
  model: string;
  harnessTaskId: string;
  projectPath: string;
  baseCommit: string;
  projectId: string;
  start: number;
  diff?: { bytes: number; tokens: number | null; costUsd: number | null };
  status: 'running' | 'done' | 'failed' | 'timeout';
}

function getBaseCommit(repoPath: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'], env: process.env })
    .toString()
    .trim();
}

export async function runConsensusEval(
  tasks: BenchmarkTask[],
  options: ConsensusOptions,
): Promise<ConsensusResult[]> {
  const {
    apiUrl,
    models,
    timeoutMs = 600_000,
    projectPrefix = 'consensus',
    tokenBudget,
    suiteName = 'consensus',
    onTaskProgress,
  } = options;

  if (models.length === 0) {
    throw new Error('Consensus requires at least one model');
  }

  // One consolidated report per "consensus" entity, plus per-model sub-reports
  // so the existing dashboard code can compare consensus vs individual agents.
  const candidatesByModel: Record<string, ConsensusResult> = {};
  for (const m of models) {
    candidatesByModel[`${m.provider}/${m.model}`] = {
      provider: m.provider,
      model: m.model,
      report: {
        timestamp: new Date().toISOString(),
        suite: suiteName,
        total: 0,
        passed: 0,
        failed: 0,
        timeouts: 0,
        totalDurationMs: 0,
        results: [],
        consensus: {
          total: 0,
          passed: 0,
          failed: 0,
          passRate: 0,
          totalDurationMs: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          winsByModel: {},
        },
      },
    };
  }

  const winsByModel: Record<string, number> = {};

  // Top-level "consensus" pseudo-model for the dashboard.
  const consensusReport: ConsensusResult = {
    provider: 'consensus',
    model: models.map((m) => m.model).join('+'),
    report: {
      timestamp: new Date().toISOString(),
      suite: suiteName,
      total: 0,
      passed: 0,
      failed: 0,
      timeouts: 0,
      totalDurationMs: 0,
      results: [],
      consensus: {
        total: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
        totalDurationMs: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        winsByModel: {},
      },
    },
  };

  const baseDir = path.join(omegaWorkDir(), 'bench', String(Date.now()));
  await fs.mkdir(baseDir, { recursive: true });

  let totalTokens = 0;
  let totalCost = 0;
  let totalPassed = 0;
  let totalDuration = 0;

  for (const task of tasks) {
    const taskStart = Date.now();

    // For each model, create a fresh project dir + harness task and run them in parallel.
    const runs: CandidateRun[] = [];
    const setupPromises: Promise<void>[] = [];

    for (const m of models) {
      const runId = `${task.id}-${m.provider}-${m.model}`.replace(/[^a-z0-9-]+/gi, '-');
      const projectPath = path.join(baseDir, runId);
      setupPromises.push(
        (async () => {
          await fs.mkdir(projectPath, { recursive: true });
          if (task.setup) {
            await task.setup(projectPath);
          }
          ensureGitRepo(projectPath);
        })(),
      );
      runs.push({
        provider: m.provider,
        model: m.model,
        harnessTaskId: '',
        projectPath,
        baseCommit: '',
        projectId: '',
        start: Date.now(),
        status: 'running',
      });
    }

    await Promise.all(setupPromises);

    // Register all harness tasks and capture base commits.
    for (const r of runs) {
      const baseCommit = getBaseCommit(r.projectPath);
      r.baseCommit = baseCommit;
      const projectName = `${projectPrefix}-${r.provider}-${r.model}-${task.id}`.slice(0, 200);
      const project = await ensureProject(apiUrl, projectName, r.projectPath);
      r.projectId = project.id;
      const harnessTask = await createTask(apiUrl, project.id, task.title, {
        description: task.description,
        complexity: task.complexity ?? 'simple',
        // Tag routing in the server (apps/server/src/lib/run-task.ts):
        //   external:<cli>  → runExternalAgentTask (PTY-based CLI like agy/opencode)
        //   agent            → runAgentTask (full agent loop with tools)
        // For internal models we add 'agent' so the harness uses the full
        // agent loop (otherwise it falls through to a one-shot provider.send()
        // that just returns text with no tool use and no diff).
        tags: [
          'benchmark',
          'consensus',
          `consensus:${r.provider}/${r.model}`,
          ...(r.provider === 'external' ? [`external:${r.model}`] : ['agent']),
          task.name,
          ...(task.tags ?? []),
        ],
      });
      r.harnessTaskId = harnessTask.id;

      // For internal models, PATCH the task with provider/model so the
      // server's router picks the right model. External CLIs use the tag
      // path above instead.
      if (r.provider !== 'external') {
        await fetch(`${apiUrl}/tasks/${harnessTask.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: r.provider, model: r.model }),
        });
      }
    }

    // Fire all agent runs in parallel.
    await Promise.all(
      runs.map(async (r) => {
        try {
          await runTask(apiUrl, r.harnessTaskId, tokenBudget);
        } catch (err) {
          console.warn('consensus: runTask failed', {
            taskId: r.harnessTaskId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    // Wait for all to complete in parallel.
    await Promise.all(
      runs.map(async (r) => {
        const finished = await waitForTask(apiUrl, r.harnessTaskId, timeoutMs);
        r.status = finished.status === 'done' ? 'done' : finished.status === 'timeout' ? 'timeout' : 'failed';
        // On timeout, give the agent up to 3 minutes to commit its patch.
        const diffs =
          r.status === 'timeout'
            ? await pollForDiffs(apiUrl, r.harnessTaskId)
            : await getDiffs(apiUrl, r.harnessTaskId);
        // Poll briefly for the agent-run record to flush (the agent loop
        // writes token counts as the very last step before flipping status to
        // 'done', so we sometimes race the write).
        let agentRun: Awaited<ReturnType<typeof getAgentRun>>;
        for (let attempt = 0; attempt < 5; attempt++) {
          agentRun = await getAgentRun(apiUrl, r.harnessTaskId);
          if (agentRun?.totalTokens != null) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const totalPatchBytes = diffs.reduce((sum, d) => sum + d.patch.length, 0);
        r.diff = {
          bytes: totalPatchBytes,
          tokens: agentRun?.totalTokens ?? null,
          costUsd: agentRun?.costUsd ?? null,
        };
      }),
    );

    // Collect candidate summaries.
    const candidates: ConsensusCandidate[] = runs.map((r) => ({
      provider: r.provider,
      model: r.model,
      harnessTaskId: r.harnessTaskId,
      agentRunId: undefined,
      patchBytes: r.diff?.bytes ?? 0,
      durationMs: Date.now() - r.start,
      totalTokens: r.diff?.tokens ?? null,
      costUsd: r.diff?.costUsd ?? null,
      evalPassed: null,
      evalMessage: '',
    }));

    // Best-of-N: try each candidate's patch on a clean eval checkout, smallest first.
    // We use the first run's projectPath as the eval sandbox (it has the setup + git repo).
    // We apply the candidate's patch (from the same task) to this sandbox and call
    // the task's evaluate() function. If it passes, this candidate wins.
    const evalSandbox = runs[0].projectPath;
    const evalBaseCommit = runs[0].baseCommit;

    // Build ordered list of candidates: those with a non-empty patch first,
    // smallest diff first (better signal than biggest). Empty-patch candidates
    // only considered if nothing else passes.
    const withPatch = candidates
      .map((c, i) => ({ c, run: runs[i] }))
      .filter((x) => x.c.patchBytes > 0)
      .sort((a, b) => a.c.patchBytes - b.c.patchBytes);
    const withoutPatch = candidates
      .map((c, i) => ({ c, run: runs[i] }))
      .filter((x) => x.c.patchBytes === 0);

    let winner: { c: ConsensusCandidate; run: CandidateRun } | null = null;

    for (const candidate of [...withPatch, ...withoutPatch]) {
      resetToCommit(evalSandbox, evalBaseCommit);

      // Get this candidate's actual patch from the server.
      const candidateDiffs = await getDiffs(apiUrl, candidate.run.harnessTaskId);
      const patch = candidateDiffs
        .slice()
        .reverse()
        .find((d) => typeof d.patch === 'string' && d.patch.length > 0)?.patch;
      if (!patch) {
        candidate.c.evalPassed = false;
        candidate.c.evalMessage = 'no patch produced';
        continue;
      }

      // Build a synthetic EvaluationContext for the task's evaluate().
      const context: EvaluationContext = {
        apiUrl,
        taskId: candidate.run.harnessTaskId,
        projectPath: evalSandbox,
        projectId: candidate.run.projectId,
        diffs: [{ id: 'consensus', branch: 'master', patch }],
      };

      let evalResult: BenchmarkEvaluation;
      try {
        evalResult = await task.evaluate(context);
      } catch (err) {
        evalResult = {
          passed: false,
          message: `evaluator threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      candidate.c.evalPassed = evalResult.passed;
      candidate.c.evalMessage = evalResult.message ?? (evalResult.passed ? 'passed' : 'failed');

      if (evalResult.passed) {
        winner = candidate;
        break;
      }
    }

    const taskPassed = winner !== null;
    const taskDurationMs = Date.now() - taskStart;
    const taskTotalTokens = candidates.reduce((sum, c) => sum + (c.totalTokens ?? 0), 0);
    const taskTotalCost = candidates.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);

    if (taskPassed && winner) {
      totalPassed++;
      const winnerKey = `${winner.c.provider}/${winner.c.model}`;
      winsByModel[winnerKey] = (winsByModel[winnerKey] ?? 0) + 1;
    }
    totalTokens += taskTotalTokens;
    totalCost += taskTotalCost;
    totalDuration += taskDurationMs;

    // Build the per-task report.
    const taskReport: ConsensusTaskReport = {
      task,
      passed: taskPassed,
      durationMs: taskDurationMs,
      winner: winner?.c ?? null,
      candidates,
      totalTokens: taskTotalTokens,
      totalCostUsd: Number(taskTotalCost.toFixed(4)),
    };

    if (onTaskProgress) onTaskProgress(task.id, taskReport);

    // Record into the consensus pseudo-model.
    consensusReport.report.results.push({
      task,
      harnessTaskId: winner?.run.harnessTaskId ?? runs[0].harnessTaskId,
      durationMs: taskDurationMs,
      status: taskPassed ? 'done' : 'failed',
      evaluation: {
        passed: taskPassed,
        message: winner ? `winner: ${winner.c.provider}/${winner.c.model}` : 'no candidate passed',
        metrics: {
          winnerProvider: winner?.c.provider ?? '',
          winnerModel: winner?.c.model ?? '',
          candidatesTried: candidates.length,
          candidatesPassed: candidates.filter((c) => c.evalPassed).length,
          totalCandidatesTokens: taskTotalTokens,
          totalCandidatesCostUsd: taskTotalCost,
        },
      },
      agentRun: undefined,
      diffs: undefined,
      spanCount: 0,
    });
    consensusReport.report.total++;
    if (taskPassed) consensusReport.report.passed++;
    else consensusReport.report.failed++;
    consensusReport.report.totalDurationMs += taskDurationMs;

    // Also record into per-model sub-reports so the dashboard can show
    // "for this task, model X was the winner" etc.
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      const c = candidates[i];
      const key = `${r.provider}/${r.model}`;
      const sub = candidatesByModel[key];
      sub.report.total++;
      sub.report.totalDurationMs += c.durationMs;
      // Per-model counters:
      //   passed = candidate's own patch passed eval (only counts if we
      //            actually tested it, which we don't for non-winners when
      //            an earlier candidate wins).
      //   tried = candidate was actually tested (won or tried before a winner)
      //   won   = this candidate's patch was selected as the consensus winner
      // The meaningful per-model pass rate is `passed / tried` — fraction
      // of tested candidates that succeeded.
      const candidateWon = !!winner && winner.c.provider === r.provider && winner.c.model === r.model;
      const candidateTried = candidateWon || c.evalPassed;
      if (candidateTried && c.evalPassed) sub.report.passed++;
      else if (candidateTried) sub.report.failed++;
      sub.report.results.push({
        task,
        harnessTaskId: r.harnessTaskId,
        durationMs: c.durationMs,
        status: r.status === 'done' ? 'done' : (r.status === 'timeout' ? 'timeout' : 'failed'),
        evaluation: {
          passed: c.evalPassed ?? false,
          message: candidateWon
            ? 'WON consensus'
            : c.evalMessage || 'did not win consensus',
          metrics: { won: candidateWon ? 1 : 0, tried: candidateTried ? 1 : 0, patchBytes: c.patchBytes },
        },
        agentRun:
          c.totalTokens != null || c.costUsd != null
            ? ({
                id: '',
                resultStatus: r.status === 'done' ? 'done' : (r.status === 'timeout' ? 'timeout' : 'failed'),
                totalTokens: c.totalTokens,
                costUsd: c.costUsd,
                createdAt: '',
                updatedAt: '',
              } as unknown as AgentRunInfo)
            : undefined,
        diffs: c.patchBytes > 0 ? [{ id: 'consensus', branch: 'master', patch: '' }] : undefined,
        spanCount: 0,
      });
    }
  }

  // Finalize the consensus summary.
  consensusReport.report.consensus = {
    total: tasks.length,
    passed: totalPassed,
    failed: tasks.length - totalPassed,
    passRate: tasks.length > 0 ? totalPassed / tasks.length : 0,
    totalDurationMs: totalDuration,
    totalTokens,
    totalCostUsd: Number(totalCost.toFixed(2)),
    winsByModel,
  };
  consensusReport.report.totalDurationMs = totalDuration;

  return [consensusReport, ...Object.values(candidatesByModel)];
}
