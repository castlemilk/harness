import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectUtils from './project-utils.js';

const mocks = vi.hoisted(() => ({
  boundedExecutionTimeoutMs: vi.fn().mockReturnValue(17),
  execFileAsync: vi.fn(),
}));

vi.mock('./project-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectUtils>();
  return {
    ...actual,
    boundedExecutionTimeoutMs: mocks.boundedExecutionTimeoutMs,
    execFileAsync: mocks.execFileAsync,
  };
});

import { validatePatch } from './patch-utils.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-patch-validation-'));
  roots.push(root);
  await execFileAsync('/usr/bin/git', ['init', '-q'], { cwd: root });
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boundedExecutionTimeoutMs.mockReturnValue(17);
  mocks.execFileAsync.mockImplementation(async (_command: string, args: string[]) => {
    if (args[0] === 'write-tree') return { stdout: 'prior-tree\n', stderr: '' };
    if (args[0] === 'diff') {
      return {
        stdout: 'diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-old\n+new\n',
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  });
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('validatePatch index transaction', () => {
  it('keeps index mutations unabortable while bounding read-only checks', async () => {
    const root = await makeRepo();
    const controller = new AbortController();

    const result = await validatePatch(root, 'base-sha', {
      deadlineMs: Date.now() + 1,
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    const calls = mocks.execFileAsync.mock.calls as [string, string[], Record<string, unknown>][];
    const optionsFor = (subcommand: string, secondArg?: string): Record<string, unknown> | undefined =>
      calls.find(([, args]) => args[0] === subcommand && (secondArg === undefined || args[1] === secondArg))?.[2];

    expect(optionsFor('write-tree')).toEqual({ cwd: root, timeout: 30_000 });
    expect(optionsFor('add', '-A')).toEqual({ cwd: root, timeout: 30_000 });
    expect(optionsFor('read-tree', 'prior-tree')).toEqual({ cwd: root, timeout: 30_000 });
    expect(optionsFor('diff')).toEqual({ cwd: root, timeout: 17, signal: controller.signal });
    expect(optionsFor('apply', '--check')).toEqual(expect.objectContaining({
      timeout: 17,
      signal: controller.signal,
    }));
  });

  it('does not replace the index when its original tree cannot be captured', async () => {
    const root = await makeRepo();
    mocks.execFileAsync.mockRejectedValueOnce(new Error('cannot snapshot index'));

    const result = await validatePatch(root, 'base-sha');

    expect(result).toEqual({
      success: false,
      output: expect.stringContaining('cannot snapshot index'),
    });
    expect(mocks.execFileAsync.mock.calls.some(([, args]) => args[0] === 'add')).toBe(false);
  });
});
