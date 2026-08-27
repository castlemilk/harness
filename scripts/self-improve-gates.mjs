import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function commandResult(result) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return {
    passed: result.status === 0,
    status: result.status ?? -1,
    output: output.slice(-12000),
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
    timeout: options.timeoutMs ?? 1_800_000,
    shell: false,
  });
  return commandResult(result);
}

function git(projectPath, args, options = {}) {
  const runner = options.runner ?? runCommand;
  const commandOptions = { ...options };
  delete commandOptions.runner;
  return runner('git', args, { ...commandOptions, cwd: projectPath });
}

function failed(reason, extra = {}) {
  return { passed: false, reasons: [reason], ...extra };
}

function numericMetric(report, key) {
  const value = report?.measurements?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function evaluateBenchmarkGate(baseline, candidate, tolerance = 0.1) {
  const reasons = [];
  const metrics = {};
  const requiredStatuses = [
    ['taskStatus', 'done'],
    ['grpcTaskStatus', 'done'],
  ];

  for (const [key, expected] of requiredStatuses) {
    const value = candidate?.measurements?.[key];
    if (value !== expected) reasons.push(`candidate ${key} was ${String(value ?? 'missing')}, expected ${expected}`);
  }

  const metricKeys = ['httpCreateTaskMs', 'taskRunTotalMs', 'grpcSubmitTaskMs', 'grpcTaskRunTotalMs'];
  for (const key of metricKeys) {
    const baselineValue = numericMetric(baseline, key);
    const candidateValue = numericMetric(candidate, key);
    if (baselineValue === undefined || candidateValue === undefined) {
      reasons.push(`benchmark metric ${key} is missing from baseline or candidate`);
      continue;
    }
    const allowance = Math.max(100, baselineValue * tolerance);
    const maxAllowed = baselineValue + allowance;
    const passed = candidateValue <= maxAllowed;
    metrics[key] = {
      baselineMs: baselineValue,
      candidateMs: candidateValue,
      deltaMs: candidateValue - baselineValue,
      maxAllowedMs: maxAllowed,
      passed,
    };
    if (!passed) {
      reasons.push(`${key} regressed by ${String(candidateValue - baselineValue)}ms beyond ${String(Math.round(allowance))}ms tolerance`);
    }
  }

  return { passed: reasons.length === 0, reasons, metrics };
}

async function latestBenchmarkReport(reportRoot) {
  const reportsDir = path.join(reportRoot, 'reports');
  const files = (await fs.readdir(reportsDir))
    .filter((file) => file.startsWith('benchmark-') && file.endsWith('.json'))
    .sort()
    .reverse();
  const file = files[0];
  if (!file) return undefined;
  const data = JSON.parse(await fs.readFile(path.join(reportsDir, file), 'utf8'));
  return { file: path.join(reportsDir, file), data };
}

async function runBenchmark(projectPath, reportRoot, timeoutMs, runner = runCommand) {
  await fs.mkdir(reportRoot, { recursive: true });
  const result = runner('node', [path.join(projectPath, 'scripts', 'run-benchmarks.mjs')], {
    cwd: projectPath,
    env: { OMEGA_STORAGE_ROOT: reportRoot },
    timeoutMs,
  });
  const report = result.passed ? await latestBenchmarkReport(reportRoot) : undefined;
  return { ...result, report };
}

async function validateCandidate(candidatePath, reportRoot, timeoutMs, runner = runCommand) {
  const env = { OMEGA_STORAGE_ROOT: reportRoot };
  const steps = [];
  const run = (name, command, args) => {
    const result = runner(command, args, { cwd: candidatePath, env, timeoutMs });
    steps.push({ name, ...result });
    return result;
  };

  const install = run('install', 'pnpm', ['install', '--frozen-lockfile', '--prefer-offline']);
  if (!install.passed) return { passed: false, steps };

  // Build the benchmark's dependencies first because the workspace bundle does
  // not declare every build-time relationship and recursive builds can race.
  const benchBuild = run('bench-build', 'pnpm', ['--filter', '@omega/bench', 'build']);
  if (!benchBuild.passed) return { passed: false, steps };

  const build = run('build', 'pnpm', ['-r', 'build']);
  if (!build.passed) return { passed: false, steps };

  const lint = run('lint', 'pnpm', ['lint']);
  if (!lint.passed) return { passed: false, steps };

  const tests = run('test', 'pnpm', ['-r', 'test']);
  return { passed: tests.passed, steps };
}

async function removeValidationWorktree(projectPath, worktreePath, runner = runCommand) {
  if (!worktreePath) return;
  const result = git(projectPath, ['worktree', 'remove', '--force', worktreePath], { timeoutMs: 60_000, runner });
  if (!result.passed) {
    console.warn(`Could not remove candidate validation worktree ${worktreePath}: ${result.output}`);
  }
}

export async function validateAndPromoteCandidate(options) {
  const {
    projectPath,
    branch,
    baseCommit,
    taskStatus,
    agentRunStatus,
    diffPatch,
    iteration,
    storageRoot = process.env.OMEGA_STORAGE_ROOT ?? path.join(os.homedir(), '.omega'),
    validationTimeoutMs = 1_800_000,
    benchmarkTolerance = 0.1,
    promotionBranch = 'main',
    commandRunner = runCommand,
  } = options;

  if (taskStatus !== 'done') return failed(`task status is ${String(taskStatus)}, not done`);
  if (agentRunStatus !== 'done') return failed(`agent run status is ${String(agentRunStatus)}, not done`);
  if (typeof branch !== 'string' || branch.length === 0) return failed('candidate branch is missing');
  if (typeof baseCommit !== 'string' || baseCommit.length === 0) return failed('candidate base commit is missing');
  if (typeof diffPatch !== 'string' || diffPatch.trim().length === 0) return failed('candidate diff is empty');

  const branchRef = git(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { runner: commandRunner });
  if (!branchRef.passed) return failed(`candidate branch does not exist: ${branch}`);

  const currentBranch = git(projectPath, ['symbolic-ref', '--short', 'HEAD'], { runner: commandRunner });
  if (!currentBranch.passed) return failed('could not determine promotion branch');
  const currentHead = git(projectPath, ['rev-parse', 'HEAD'], { runner: commandRunner });
  if (!currentHead.passed) return failed('could not determine current commit');
  const clean = git(projectPath, ['status', '--porcelain'], { runner: commandRunner });
  if (!clean.passed || clean.output.length > 0) return failed('promotion checkout is not clean');

  const candidateCommit = git(projectPath, ['rev-parse', branch], { runner: commandRunner });
  if (!candidateCommit.passed) return failed('could not resolve candidate commit');
  const diffCheck = git(projectPath, ['diff', '--quiet', baseCommit, candidateCommit.output], { runner: commandRunner });
  if (diffCheck.passed) return failed('candidate branch contains no changes over its base commit');
  if (diffCheck.status !== 1) return failed(`could not inspect candidate diff: ${diffCheck.output}`);

  const gateRoot = path.join(storageRoot, 'candidate-gates', `iteration-${String(iteration)}`);
  const baselineRoot = path.join(gateRoot, 'baseline');
  const candidateRoot = path.join(gateRoot, 'candidate');
  const worktreePath = path.join(gateRoot, 'worktree');
  let candidateValidation;
  let baselineBenchmark;
  let candidateBenchmark;
  let worktreeCreated = false;

  try {
    baselineBenchmark = await runBenchmark(projectPath, baselineRoot, validationTimeoutMs, commandRunner);
    if (!baselineBenchmark.passed || !baselineBenchmark.report) {
      return failed('baseline benchmark failed', { baselineBenchmark });
    }

    const worktree = git(projectPath, ['worktree', 'add', '--detach', worktreePath, candidateCommit.output], {
      timeoutMs: 60_000,
      runner: commandRunner,
    });
    if (!worktree.passed) return failed(`could not create candidate validation worktree: ${worktree.output}`);
    worktreeCreated = true;

    candidateValidation = await validateCandidate(worktreePath, candidateRoot, validationTimeoutMs, commandRunner);
    if (!candidateValidation.passed) {
      return failed('candidate validation failed', { baselineBenchmark, candidateValidation });
    }

    candidateBenchmark = await runBenchmark(worktreePath, candidateRoot, validationTimeoutMs, commandRunner);
    if (!candidateBenchmark.passed || !candidateBenchmark.report) {
      return failed('candidate benchmark failed', { baselineBenchmark, candidateValidation, candidateBenchmark });
    }

    const benchmarkGate = evaluateBenchmarkGate(
      baselineBenchmark.report.data,
      candidateBenchmark.report.data,
      benchmarkTolerance,
    );
    if (!benchmarkGate.passed) {
      return failed('candidate benchmark regressed', {
        baselineBenchmark,
        candidateValidation,
        candidateBenchmark,
        benchmarkGate,
      });
    }

    const promotionBranchRef = git(projectPath, ['symbolic-ref', '--short', 'HEAD'], { runner: commandRunner });
    const promotionHead = git(projectPath, ['rev-parse', 'HEAD'], { runner: commandRunner });
    const promotionClean = git(projectPath, ['status', '--porcelain'], { runner: commandRunner });
    if (promotionHead.output !== baseCommit) return failed('base commit changed while candidate was being validated', { baselineBenchmark, candidateValidation, candidateBenchmark, benchmarkGate });
    if (!promotionClean.passed || promotionClean.output.length > 0) return failed('promotion checkout became dirty during validation', { baselineBenchmark, candidateValidation, candidateBenchmark, benchmarkGate });
    if (!promotionBranchRef.passed || promotionBranchRef.output !== promotionBranch) return failed(`refusing promotion from branch ${promotionBranchRef.output || '(detached HEAD)'}; expected ${promotionBranch}`, { baselineBenchmark, candidateValidation, candidateBenchmark, benchmarkGate });

    const merge = git(projectPath, ['merge', '--ff-only', branch], { timeoutMs: 60_000, runner: commandRunner });
    if (!merge.passed) return failed(`candidate fast-forward promotion failed: ${merge.output}`, { baselineBenchmark, candidateValidation, candidateBenchmark, benchmarkGate });

    return {
      passed: true,
      promoted: true,
      branch,
      baseCommit,
      candidateCommit: candidateCommit.output,
      baselineBenchmark,
      candidateValidation,
      candidateBenchmark,
      benchmarkGate,
    };
  } finally {
    if (worktreeCreated) await removeValidationWorktree(projectPath, worktreePath, commandRunner);
  }
}
