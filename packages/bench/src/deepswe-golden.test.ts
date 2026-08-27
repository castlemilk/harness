import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BenchmarkTask, EvaluationContext } from './types.js';
import {
  formatDeepSWEGoldenSummary,
  runDeepSWEGoldenCorpus,
  type DeepSWEGoldenManifest,
} from './deepswe-golden.js';

const roots: string[] = [];

async function writeCorpus(
  expected: DeepSWEGoldenManifest['fixtures'][number]['expected'],
): Promise<{ manifestPath: string; patch: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-golden-test-'));
  roots.push(root);
  const patch = 'diff --git a/value.ts b/value.ts\n--- a/value.ts\n+++ b/value.ts\n@@ -1 +1 @@\n-old\n+new\n';
  await fs.mkdir(path.join(root, 'patches'));
  await fs.writeFile(path.join(root, 'patches', 'sample.patch'), patch);
  const manifest: DeepSWEGoldenManifest = {
    version: 1,
    name: 'test corpus',
    sourceBenchmarkRunId: 'source-run',
    fixtures: [{
      taskId: 'sample-task',
      sourceHarnessTaskId: 'source-task',
      sourceTaskDiffId: 'source-diff',
      patchFile: 'patches/sample.patch',
      patchSha256: crypto.createHash('sha256').update(patch).digest('hex'),
      sourceDurationMs: 123_456,
      expected,
    }],
  };
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  return { manifestPath, patch };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('DeepSWE golden corpus replay', () => {
  it('sets up the base repository, grades the stored patch, and reports an exact match', async () => {
    const expected = {
      passed: false,
      f2p_passed: 1,
      f2p_total: 2,
      p2p_passed: 119,
      p2p_total: 119,
    };
    const { manifestPath, patch } = await writeCorpus(expected);
    const setup = vi.fn(async (projectPath: string) => {
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(path.join(projectPath, 'base-ready'), 'yes');
    });
    const { passed: expectedPassed, ...expectedMetrics } = expected;
    const evaluate = vi.fn(async (ctx: EvaluationContext) => {
      expect(ctx.taskId).toBe('source-task');
      expect(ctx.diffs).toEqual([{ id: 'source-diff', branch: 'golden-replay', patch }]);
      return {
        passed: expectedPassed,
        score: 0.99,
        metrics: { ...expectedMetrics, verifier_mode: 'docker' },
      };
    });
    const loadTasks = vi.fn(async () => [{
      id: 'deepswe-sample-task',
      name: 'sample-task',
      title: 'Sample task',
      setup,
      evaluate,
    } satisfies BenchmarkTask]);

    const result = await runDeepSWEGoldenCorpus({
      manifestPath,
      tasksDir: '/unused/tasks',
      useDocker: true,
    }, { loadTasks });

    expect(loadTasks).toHaveBeenCalledWith(expect.objectContaining({
      taskIds: ['sample-task'],
      tasksDir: '/unused/tasks',
      useDocker: true,
    }));
    // The Docker verifier builds its own repo inside the image, so replay must
    // not pay for a clone + dependency install. Measured 1402s of setup against
    // a 12s verifier before this skip.
    expect(setup).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(result.matched).toBe(1);
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({
      taskId: 'sample-task',
      matched: true,
      expected,
      actual: expected,
      sourceDurationMs: 123_456,
    });
    expect(formatDeepSWEGoldenSummary(result)).toContain('1/1 outcomes matched');
  });

  it('falls back to a real project when Docker did not grade the run', async () => {
    // Skipping setup is only safe while the Docker verifier is the one
    // grading. If the adapter fell back to the local verifier, that path DOES
    // read projectPath, so the fixture must be redone with a real checkout
    // rather than graded against an empty directory.
    const expected = { passed: true, f2p_passed: 1, f2p_total: 1, p2p_passed: 2, p2p_total: 2 };
    const { manifestPath, patch } = await writeCorpus(expected);
    const setup = vi.fn(async (projectPath: string) => {
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(path.join(projectPath, 'base-ready'), 'yes');
    });
    const { passed: expectedPassed, ...expectedMetrics } = expected;
    let call = 0;
    const evaluate = vi.fn(async (ctx: EvaluationContext) => {
      call++;
      if (call === 1) {
        // Docker was unavailable: the adapter graded locally against the
        // empty directory we handed it.
        return { passed: false, metrics: { ...expectedMetrics, verifier_mode: 'local' } };
      }
      expect(await fs.readFile(path.join(ctx.projectPath, 'base-ready'), 'utf8')).toBe('yes');
      expect(ctx.diffs).toEqual([{ id: 'source-diff', branch: 'golden-replay', patch }]);
      return { passed: expectedPassed, metrics: { ...expectedMetrics, verifier_mode: 'local' } };
    });
    const loadTasks = vi.fn(async () => [{
      id: 'deepswe-sample-task',
      name: 'sample-task',
      title: 'Sample task',
      setup,
      evaluate,
    } satisfies BenchmarkTask]);

    const result = await runDeepSWEGoldenCorpus(
      { manifestPath, tasksDir: '/unused/tasks', useDocker: true },
      { loadTasks },
    );

    expect(setup).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(1);
    expect(result.results[0]?.setupDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports reward drift field by field and exits the corpus result unsuccessfully', async () => {
    const expected = {
      passed: true,
      f2p_passed: 6,
      f2p_total: 6,
      p2p_passed: 10,
      p2p_total: 10,
    };
    const { manifestPath } = await writeCorpus(expected);
    const loadTasks = async (): Promise<BenchmarkTask[]> => [{
      id: 'deepswe-sample-task',
      name: 'sample-task',
      title: 'Sample task',
      setup: async (projectPath) => { await fs.mkdir(projectPath, { recursive: true }); },
      evaluate: async () => ({
        passed: false,
        metrics: { f2p_passed: 5, f2p_total: 6, p2p_passed: 9, p2p_total: 10 },
      }),
    }];

    const result = await runDeepSWEGoldenCorpus({
      manifestPath,
      tasksDir: '/unused/tasks',
    }, { loadTasks });

    expect(result.matched).toBe(0);
    expect(result.results[0]?.differences).toEqual([
      'passed: expected true, received false',
      'f2p_passed: expected 6, received 5',
      'p2p_passed: expected 10, received 9',
    ]);
    const summary = formatDeepSWEGoldenSummary(result);
    expect(summary).toContain('FAIL sample-task');
    expect(summary).toContain('f2p_passed: expected 6, received 5');
    expect(summary).toContain('0/1 outcomes matched');
  });

  it('rejects a changed patch before loading or setting up a task', async () => {
    const expected = {
      passed: true,
      f2p_passed: 1,
      f2p_total: 1,
      p2p_passed: 1,
      p2p_total: 1,
    };
    const { manifestPath } = await writeCorpus(expected);
    await fs.appendFile(path.join(path.dirname(manifestPath), 'patches', 'sample.patch'), 'tampered\n');
    const loadTasks = vi.fn(async (): Promise<BenchmarkTask[]> => []);

    await expect(runDeepSWEGoldenCorpus({
      manifestPath,
      tasksDir: '/unused/tasks',
    }, { loadTasks })).rejects.toThrow(/SHA-256 mismatch.*sample-task/u);
    expect(loadTasks).not.toHaveBeenCalled();
  });
});
