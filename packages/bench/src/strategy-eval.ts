/**
 * Multi-strategy evaluation: run each task under multiple harness
 * strategies and measure which strategy helps which task type.
 *
 * A "strategy" varies one or more of:
 *  - The system prompt (concise vs verbose, research-first, verify-before-finish)
 *  - The tool set available to the agent (read-only, full, with bash)
 *  - The token budget / max steps
 *
 * The output is a per-(task, strategy) pass/fail table plus a per-strategy
 * summary showing which strategies are most useful for which capability
 * categories. This is the eval half of the self-improvement loop: by
 * knowing which strategies work, we can decide which harness features
 * to invest in.
 *
 * Strategies currently implemented as prompt variants that prepend
 * instructions to the harness's standard agent prompt. Tool restriction
 * would need hooks in the harness server (TODO).
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { omegaWorkDir } from '@omega/core';
import type { BenchmarkTask, BenchmarkReport, BenchmarkEvaluation } from './types.js';
import {
  ensureProject,
  createTask,
  runTask,
  waitForTask,
  getAgentRun,
  getDiffs,
  pollForDiffs,
  countSpans,
} from './api-client.js';

/**
 * Strategy prompt snippets prepended to the harness's standard prompt.
 * Empty string = use the default prompt as-is.
 */
export type StrategyName = 'default' | 'verify-before-finish' | 'research-first' | 'concise' | 'plan-then-execute';

export const STRATEGY_PROMPTS: Record<StrategyName, string> = {
  // Baseline: nothing extra.
  default: '',
  // Forces an explicit verification step before finish.
  'verify-before-finish': [
    'VERIFICATION PROTOCOL (must follow before calling finish):',
    '1. Re-read the original task description and the spec/hidden tests.',
    '2. Check your patch against the spec line-by-line. If the spec mentions a',
    '   specific contract (e.g. "returns null when arr is empty", "max length 80",',
    '   "do not modify callers"), verify your patch satisfies it.',
    '3. Run the test command manually and check the output. A passing test does',
    '   not guarantee the fix is correct — look for the spec, not just the test.',
    '4. If the test passes but the spec might be violated, look for a hidden spec',
    '   file (SPEC.md, hidden spec tests, etc.) and run those too.',
    '5. If your fix only satisfies visible tests, you may be wrong — read the',
    '   hidden spec and verify.',
  ].join('\n'),
  // Forces reading everything before any edit.
  'research-first': [
    'RESEARCH-FIRST PROTOCOL:',
    '1. Before editing ANY file, use search and read_file to enumerate ALL files',
    '   that may be relevant (imports, callers, configs, specs).',
    '2. Read every file you find end-to-end. Read SPEC.md or other spec files',
    '   if they exist.',
    '3. Form a hypothesis about WHERE the bug is and WHY before editing.',
    '4. After editing, verify your fix matches the spec, not just the tests.',
    'Do not edit any file until you have read all relevant source.',
  ].join('\n'),
  // Shorter prompt — minimal context, see if less is more.
  concise: [
    'Be concise. Read only what you need. Prefer search over reading whole files.',
    'Edit minimally. Run the test to verify. Finish quickly.',
  ].join('\n'),
  // Forces explicit planning before doing.
  'plan-then-execute': [
    'PLAN-THEN-EXECUTE PROTOCOL:',
    '1. Use the think tool to write a 3-5 step plan: what files to read, what',
    '   the bug likely is, what the fix should look like.',
    '2. Review your plan against the task description and any spec.',
    '3. Execute the plan step by step. After each edit, verify against your plan.',
    '4. If the plan is wrong, revise before continuing.',
  ].join('\n'),
};

export interface StrategyOptions {
  apiUrl: string;
  strategies: StrategyName[];
  timeoutMs?: number;
  projectPrefix?: string;
  /** Optional model override (defaults to whatever the server routes). */
  provider?: string;
  model?: string;
  tokenBudget?: number;
  suiteName?: string;
  onProgress?: (taskId: string, report: StrategyTaskReport) => void;
}

export interface StrategyCandidate {
  strategy: StrategyName;
  passed: boolean;
  durationMs: number;
  totalTokens: number | null;
  costUsd: number | null;
  evalMessage: string;
  patchBytes: number;
}

export interface StrategyTaskReport {
  task: BenchmarkTask;
  /** All strategies tried, in order. The first passing wins. */
  candidates: StrategyCandidate[];
  /** The winning strategy (first one that passed), if any. */
  winner: StrategyName | null;
  passed: boolean;
  durationMs: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface StrategySummary {
  total: number;
  /** Fraction of tasks where at least one strategy passed. */
  unionPassRate: number;
  /** Per-strategy individual pass rate (some strategies will lose to the first-passing one). */
  perStrategy: Record<StrategyName, { runs: number; passes: number; passRate: number; avgDurationMs: number }>;
  /** Wins by strategy. */
  winsByStrategy: Record<StrategyName, number>;
}

export interface StrategyResult {
  /** Per-task reports. */
  tasks: StrategyTaskReport[];
  /** Aggregate stats. */
  summary: StrategySummary;
}

function ensureGitRepo(repoPath: string): void {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'ignore' });
    return;
  } catch {
    // not a git repo
  }
  execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['config', 'user.email', 'bench@omega.local'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['config', 'user.name', 'Omega Bench'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['commit', '-m', 'bench init'], { cwd: repoPath, stdio: 'ignore', env: process.env });
}

function resetToCommit(repoPath: string, commit: string): void {
  execFileSync('git', ['reset', '--hard', commit], { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
  execFileSync('git', ['clean', '-fd'], { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
}

function tryGitApply(repoPath: string, patch: string): boolean {
  const tmp = path.join(repoPath, '.strategy-apply.patch');
  // Strip index lines — the blob hashes won't match after reset and git
  // apply chokes on them even when context lines are correct.
  const cleaned = patch.replace(/^index\s+[0-9a-f]+\.\.[0-9a-f]+\s+\d+\n/m, '');
  fsSync.writeFileSync(tmp, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`);
  try {
    execFileSync('git', ['apply', '--whitespace=nowarn', tmp], { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
    return true;
  } catch {
    // Try 3-way merge as fallback (uses patch hunks, not index hashes).
    try {
      execFileSync('git', ['apply', '--3way', '--whitespace=nowarn', tmp], { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
      return true;
    } catch {
      // Last resort: use the `patch` command which is more tolerant.
      try {
        const patchOutput = execFileSync('patch', ['-p1', '--no-backup-if-mismatch', '-f'], { cwd: repoPath, input: cleaned, stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
        return true;
      } catch {
        return false;
      }
    }
  } finally {
    try { fsSync.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export async function runStrategyEval(
  tasks: BenchmarkTask[],
  options: StrategyOptions,
): Promise<StrategyResult> {
  const {
    apiUrl,
    strategies,
    timeoutMs = 600_000,
    projectPrefix = 'strategy',
    provider,
    model,
    tokenBudget,
    suiteName = 'strategy',
    onProgress,
  } = options;

  if (strategies.length === 0) {
    throw new Error('Strategy eval requires at least one strategy');
  }

  const taskReports: StrategyTaskReport[] = [];
  const winsByStrategy: Record<StrategyName, number> = {
    default: 0,
    'verify-before-finish': 0,
    'research-first': 0,
    concise: 0,
    'plan-then-execute': 0,
  };
  const perStrategy: Record<StrategyName, { runs: number; passes: number; totalDurationMs: number }> = {
    default: { runs: 0, passes: 0, totalDurationMs: 0 },
    'verify-before-finish': { runs: 0, passes: 0, totalDurationMs: 0 },
    'research-first': { runs: 0, passes: 0, totalDurationMs: 0 },
    concise: { runs: 0, passes: 0, totalDurationMs: 0 },
    'plan-then-execute': { runs: 0, passes: 0, totalDurationMs: 0 },
  };

  const baseDir = path.join(omegaWorkDir(), 'bench', String(Date.now()));
  await fs.mkdir(baseDir, { recursive: true });

  for (const task of tasks) {
    const taskStart = Date.now();
    const candidates: StrategyCandidate[] = [];

    // Set up project dir once. All strategies share the same setup.
    const projectPath = path.join(baseDir, task.id);
    await fs.mkdir(projectPath, { recursive: true });
    if (task.setup) {
      await task.setup(projectPath);
    }
    ensureGitRepo(projectPath);
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, stdio: ['ignore', 'pipe', 'ignore'], env: process.env })
      .toString()
      .trim();
    const project = await ensureProject(apiUrl, `${projectPrefix}-${task.id}`, projectPath);
    const projectId = project.id;

    // Run each strategy in order. Stop at the first passing patch.
    let winner: StrategyName | null = null;

    for (const strategy of strategies) {
      // Reset the project for each strategy.
      resetToCommit(projectPath, baseCommit);

      // Build the harness task with the strategy's prompt prefix.
      const strategyPrompt = STRATEGY_PROMPTS[strategy];
      const description = task.description ?? '';
      const fullDescription = strategyPrompt
        ? `${description}\n\n---\n\n# Strategy instructions (${strategy})\n\n${strategyPrompt}\n`
        : description;

      const harnessTask = await createTask(apiUrl, projectId, task.title, {
        description: fullDescription,
        complexity: task.complexity ?? 'simple',
        // 'agent' tag is what the server's run-task.ts uses to dispatch to the
        // full agent loop (vs a one-shot chat completion).
        tags: ['benchmark', 'strategy', `strategy:${strategy}`, 'agent', task.name, ...(task.tags ?? [])],
      });

      // PATCH provider/model if specified.
      if (provider || model) {
        await fetch(`${apiUrl}/tasks/${harnessTask.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, model }),
        });
      }

      const start = Date.now();
      let passed = false;
      let evalMessage = '';
      let patchBytes = 0;
      let totalTokens: number | null = null;
      let costUsd: number | null = null;

      try {
        await runTask(apiUrl, harnessTask.id, tokenBudget);
        const finished = await waitForTask(apiUrl, harnessTask.id, timeoutMs);
        const diffs =
          finished.status === 'timeout'
            ? await pollForDiffs(apiUrl, harnessTask.id)
            : await getDiffs(apiUrl, harnessTask.id);
        let agentRun: Awaited<ReturnType<typeof getAgentRun>>;
        for (let attempt = 0; attempt < 5; attempt++) {
          agentRun = await getAgentRun(apiUrl, harnessTask.id);
          if (agentRun?.totalTokens != null) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        patchBytes = diffs.reduce((sum, d) => sum + (d.patch?.length ?? 0), 0);
        totalTokens = agentRun?.totalTokens ?? null;
        costUsd = agentRun?.costUsd ?? null;

        // Reset and let the evaluator apply the patch via applyLatestPatch().
        resetToCommit(projectPath, baseCommit);
        const patch = diffs
          .slice()
          .reverse()
          .find((d) => typeof d.patch === 'string' && d.patch.length > 0)?.patch;
        if (!patch) {
          passed = false;
          evalMessage = 'no patch produced';
        } else {
          // Build eval context — evaluator handles patch application.
          const context: import('./types.js').EvaluationContext = {
            apiUrl,
            taskId: harnessTask.id,
            projectPath,
            projectId,
            diffs: [{ id: 'strategy', branch: 'master', patch }],
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
          passed = evalResult.passed;
          evalMessage = evalResult.message ?? (passed ? 'passed' : 'failed');
          if (process.env.STRATEGY_DEBUG) console.error('[strategy] eval result for', strategy, 'on', task.id, '=', passed, evalMessage);
        }
      } catch (err) {
        evalMessage = `runner error: ${err instanceof Error ? err.message : String(err)}`;
      }

      const candidate: StrategyCandidate = {
        strategy,
        passed,
        durationMs: Date.now() - start,
        totalTokens,
        costUsd,
        evalMessage,
        patchBytes,
      };
      candidates.push(candidate);
      perStrategy[strategy].runs += 1;
      perStrategy[strategy].totalDurationMs += candidate.durationMs;
      if (passed) {
        perStrategy[strategy].passes += 1;
        winner = strategy;
        winsByStrategy[strategy] += 1;
        // Don't break — we want to record all strategies' attempts for analysis.
        // But the first-passing wins for the task.
      }
    }

    const taskPassed = winner !== null;
    const taskReport: StrategyTaskReport = {
      task,
      candidates,
      winner,
      passed: taskPassed,
      durationMs: Date.now() - taskStart,
      totalTokens: candidates.reduce((s, c) => s + (c.totalTokens ?? 0), 0),
      totalCostUsd: Number(candidates.reduce((s, c) => s + (c.costUsd ?? 0), 0).toFixed(4)),
    };
    taskReports.push(taskReport);
    if (onProgress) onProgress(task.id, taskReport);
  }

  const summary: StrategySummary = {
    total: tasks.length,
    unionPassRate: tasks.length > 0 ? taskReports.filter((r) => r.passed).length / tasks.length : 0,
    perStrategy: Object.fromEntries(
      Object.entries(perStrategy).map(([k, v]) => [
        k,
        {
          runs: v.runs,
          passes: v.passes,
          passRate: v.runs > 0 ? v.passes / v.runs : 0,
          avgDurationMs: v.runs > 0 ? Math.round(v.totalDurationMs / v.runs) : 0,
        },
      ]),
    ) as StrategySummary['perStrategy'],
    winsByStrategy,
  };

  return { tasks: taskReports, summary };
}
