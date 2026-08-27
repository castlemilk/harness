import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateBenchmarkGate, runCommand, validateAndPromoteCandidate } from './self-improve-gates.mjs';

function report(measurements) {
  return { measurements };
}

describe('self-improvement benchmark gate', () => {
  it('accepts a healthy candidate within tolerance', () => {
    const result = evaluateBenchmarkGate(
      report({
        httpCreateTaskMs: 10,
        taskRunTotalMs: 1000,
        grpcSubmitTaskMs: 40,
        grpcTaskRunTotalMs: 2000,
      }),
      report({
        httpCreateTaskMs: 11,
        taskRunTotalMs: 1050,
        grpcSubmitTaskMs: 41,
        grpcTaskRunTotalMs: 2100,
        taskStatus: 'done',
        grpcTaskStatus: 'done',
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('rejects a candidate with a task failure or latency regression', () => {
    const result = evaluateBenchmarkGate(
      report({
        httpCreateTaskMs: 10,
        taskRunTotalMs: 1000,
        grpcSubmitTaskMs: 40,
        grpcTaskRunTotalMs: 2000,
      }),
      report({
        httpCreateTaskMs: 10,
        taskRunTotalMs: 1300,
        grpcSubmitTaskMs: 40,
        grpcTaskRunTotalMs: 2000,
        taskStatus: 'failed',
        grpcTaskStatus: 'done',
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'candidate taskStatus was failed, expected done',
      expect.stringContaining('taskRunTotalMs regressed'),
    ]));
  });
});

async function createCandidateRepo() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-candidate-gate-'));
  const git = (args) => runCommand('git', args, { cwd: repo });
  await fs.writeFile(path.join(repo, 'README.md'), 'baseline\n');
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'candidate-gate-fixture' }));
  git(['init', '-b', 'main']);
  git(['add', '.']);
  runCommand('git', ['-c', 'user.name=Omega Test', '-c', 'user.email=omega@example.test', 'commit', '-m', 'baseline'], { cwd: repo });
  const baseCommit = git(['rev-parse', 'HEAD']).output;
  git(['checkout', '-b', 'agent/candidate']);
  await fs.writeFile(path.join(repo, 'README.md'), 'candidate\n');
  git(['add', '.']);
  runCommand('git', ['-c', 'user.name=Omega Test', '-c', 'user.email=omega@example.test', 'commit', '-m', 'candidate'], { cwd: repo });
  const candidateCommit = git(['rev-parse', 'HEAD']).output;
  git(['checkout', 'main']);
  return { repo, baseCommit, candidateCommit };
}

function fixtureRunner(command, args, options) {
  if (command === 'pnpm') return { passed: true, status: 0, output: '', timedOut: false };
  if (command === 'node') {
    const candidate = options.cwd.endsWith('/worktree');
    const reportRoot = options.env.OMEGA_STORAGE_ROOT;
    const reportsDir = path.join(reportRoot, 'reports');
    fsSync.mkdirSync(reportsDir, { recursive: true });
    fsSync.writeFileSync(path.join(reportsDir, `benchmark-${candidate ? 'candidate' : 'baseline'}.json`), JSON.stringify({
      measurements: {
        httpCreateTaskMs: candidate ? 11 : 10,
        taskRunTotalMs: candidate ? 1050 : 1000,
        grpcSubmitTaskMs: candidate ? 41 : 40,
        grpcTaskRunTotalMs: candidate ? 2100 : 2000,
        taskStatus: 'done',
        grpcTaskStatus: 'done',
      },
    }));
    return { passed: true, status: 0, output: '', timedOut: false };
  }
  return runCommand(command, args, options);
}

describe('self-improvement candidate promotion', () => {
  it('validates the candidate worktree and fast-forwards the promotion branch', async () => {
    const { repo, baseCommit, candidateCommit } = await createCandidateRepo();
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-candidate-reports-'));
    const result = await validateAndPromoteCandidate({
      projectPath: repo,
      branch: 'agent/candidate',
      baseCommit,
      taskStatus: 'done',
      agentRunStatus: 'done',
      diffPatch: 'candidate patch',
      iteration: 'acceptance',
      storageRoot,
      commandRunner: fixtureRunner,
    });

    expect(result.passed).toBe(true);
    expect(result.promoted).toBe(true);
    expect(result.candidateCommit).toBe(candidateCommit);
    expect(runCommand('git', ['rev-parse', 'main'], { cwd: repo }).output).toBe(candidateCommit);
    await fs.rm(storageRoot, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });
});
