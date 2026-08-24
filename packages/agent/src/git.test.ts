import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getGradedDiff } from './git.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root });
  return stdout;
}

async function makeRepo(): Promise<{ root: string; base: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-graded-diff-'));
  roots.push(root);
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'omega@example.invalid');
  await git(root, 'config', 'user.name', 'Omega Test');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'value.ts'), 'export const value = 1;\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'base');
  return { root, base: (await git(root, 'rev-parse', 'HEAD')).trim() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('getGradedDiff', () => {
  it('strips committed marker paths while retaining source and legitimate tests', async () => {
    const { root, base } = await makeRepo();
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'value.ts'), 'export const value = 2;\n');
    await fs.writeFile(path.join(root, 'tests', 'value.test.ts'), 'test("value", () => {});\n');
    await fs.writeFile(path.join(root, 'tests', 'value.omega_specgate.test.ts'), 'not valid typescript {{\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'agent changes');

    const result = await getGradedDiff(root, base);

    expect(result.success).toBe(true);
    expect(result.output).toContain('src/value.ts');
    expect(result.output).toContain('tests/value.test.ts');
    expect(result.output).not.toContain('omega_specgate');
    expect(result.specGatePathsRemoved).toEqual(['tests/value.omega_specgate.test.ts']);
    expect(result.gradedPatchTestPaths).toEqual(['tests/value.test.ts']);
  });

  it('recognises root and nested marker basenames without matching ordinary source text', async () => {
    const { root, base } = await makeRepo();
    await fs.mkdir(path.join(root, 'pkg'), { recursive: true });
    await fs.writeFile(path.join(root, 'omega_specgate_probe_test.go'), 'package main\n');
    await fs.writeFile(path.join(root, 'pkg', 'test_omega_specgate_probe.py'), 'assert False\n');
    await fs.writeFile(path.join(root, 'src', 'value.ts'), 'export const omega_specgate = 2;\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'agent changes');

    const result = await getGradedDiff(root, base);

    expect(result.output).toContain('src/value.ts');
    expect(result.output).not.toContain('omega_specgate_probe_test.go');
    expect(result.output).not.toContain('test_omega_specgate_probe.py');
    expect(result.specGatePathsRemoved).toEqual([
      'omega_specgate_probe_test.go',
      'pkg/test_omega_specgate_probe.py',
    ]);
  });
});
