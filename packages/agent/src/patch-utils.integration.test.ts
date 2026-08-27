import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { validatePatch } from './patch-utils.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/git', args, { cwd: root });
  return stdout;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('validatePatch temporary index transaction', () => {
  it('restores the caller index after validating all working-tree changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-patch-index-'));
    roots.push(root);
    await git(root, 'init', '-q');
    await git(root, 'config', 'user.email', 'omega@example.invalid');
    await git(root, 'config', 'user.name', 'Omega Test');
    await fs.writeFile(path.join(root, 'value.txt'), 'base\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'base');
    const base = (await git(root, 'rev-parse', 'HEAD')).trim();

    await fs.writeFile(path.join(root, 'value.txt'), 'staged\n');
    await git(root, 'add', 'value.txt');
    const priorIndexTree = (await git(root, 'write-tree')).trim();
    await fs.writeFile(path.join(root, 'value.txt'), 'unstaged\n');
    await fs.writeFile(path.join(root, 'untracked.txt'), 'new\n');

    const result = await validatePatch(root, base);

    expect(result.success).toBe(true);
    expect((await git(root, 'write-tree')).trim()).toBe(priorIndexTree);
  });
});
