import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getGradedDiff } from './git.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const originalPath = process.env.PATH;
const originalFakeGitMode = process.env.OMEGA_TEST_GIT_MODE;

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

async function installFakeGit(root: string): Promise<void> {
  const bin = path.join(root, 'fake-bin');
  await fs.mkdir(bin);
  const script = String.raw`#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.OMEGA_TEST_GIT_MODE;
const markerPaths = Array.from({ length: 4001 }, (_, index) => 'tests/test_omega_specgate_' + String(index) + '.py');
const paths = mode === 'overflow' ? [...markerPaths, 'src/value.ts'] : ['src/value.ts'];
if (args.includes('--name-only')) {
  if (mode === 'name-fail') {
    process.stderr.write('name discovery failed');
    process.exit(7);
  }
  process.stdout.write(paths.join('\0') + '\0');
} else if (mode === 'patch-fail') {
  process.stderr.write('patch generation failed');
  process.exit(8);
} else {
  const exclusions = args.filter((arg) => arg.startsWith(':(exclude,literal)tests/test_omega_specgate_'));
  if (exclusions.length > 4000) {
    process.stderr.write('E2BIG: too many pathspec arguments');
    process.exit(9);
  }
  const patchFor = (file) => 'diff --git a/' + file + ' b/' + file + '\n--- /dev/null\n+++ b/' + file + '\n@@ -0,0 +1 @@\n+changed\n';
  process.stdout.write(paths.map(patchFor).join(''));
}
`;
  await fs.writeFile(path.join(bin, 'git'), script, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
}

afterEach(async () => {
  process.env.PATH = originalPath;
  if (originalFakeGitMode === undefined) {
    Reflect.deleteProperty(process.env, 'OMEGA_TEST_GIT_MODE');
  } else {
    process.env.OMEGA_TEST_GIT_MODE = originalFakeGitMode;
  }
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

  it('survives a typechange, which emits two diff sections for one changed path', async () => {
    // The reason marker stripping is done by git pathspecs and never by
    // re-splitting the patch text: replacing a symlink with a regular file
    // reports ONE path via --name-only but emits TWO `diff --git` sections
    // (deleted mode 120000 + new mode 100644). Any positional text filter
    // mis-aligns here and silently produces a corrupt or empty patch.
    const { root, base } = await makeRepo();
    await fs.symlink('src/value.ts', path.join(root, 'link'));
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'add symlink');
    const withLink = (await git(root, 'rev-parse', 'HEAD')).trim();
    await fs.rm(path.join(root, 'link'));
    await fs.writeFile(path.join(root, 'link'), 'now a real file\n');
    await fs.writeFile(path.join(root, 'value.omega_specgate.test.ts'), 'throwaway\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'typechange plus marker');

    const result = await getGradedDiff(root, withLink);

    expect(result.success).toBe(true);
    expect(result.output).toContain('link');
    expect(result.output).toContain('now a real file');
    expect(result.output).not.toContain('omega_specgate');
    expect(result.specGatePathsRemoved).toEqual(['value.omega_specgate.test.ts']);
    expect(base).not.toBe(withLink);
  });

  it('never exposes name-discovery errors as patch output', async () => {
    const { root } = await makeRepo();

    const result = await getGradedDiff(root, 'missing-base');

    expect(result.success).toBe(false);
    expect(result.output).toBe('');
  });

  it('never exposes patch-generation errors as patch output', async () => {
    const { root, base } = await makeRepo();
    await installFakeGit(root);
    process.env.OMEGA_TEST_GIT_MODE = 'patch-fail';

    const result = await getGradedDiff(root, base);

    expect(result.success).toBe(false);
    expect(result.output).toBe('');
  });

  it('grades the patch unstripped, and discloses it, when markers exceed the argv cap', async () => {
    // Textually re-splitting a patch to drop sections is not safe (a typechange
    // emits two `diff --git` sections for one changed path), and a mis-split
    // patch is a silent zero. Past the cap we keep the agent's work whole and
    // report the markers as present rather than as removed.
    const { root, base } = await makeRepo();
    await installFakeGit(root);
    process.env.OMEGA_TEST_GIT_MODE = 'overflow';

    const result = await getGradedDiff(root, base);

    expect(result.success).toBe(true);
    expect(result.specGatePathsRemoved).toEqual([]);
    expect(result.output).toContain('src/value.ts');
    expect(result.output).toContain('omega_specgate');
    expect(result.gradedPatchTestPaths.some((p) => p.includes('omega_specgate'))).toBe(true);
  });
});
