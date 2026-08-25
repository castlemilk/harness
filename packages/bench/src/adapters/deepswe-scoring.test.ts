import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyFailure } from '../analyse.js';
import type { BenchmarkResult } from '../types.js';
import {
  cloneRepo,
  createFlakeRerunBudget,
  decideFlakeRerun,
  deepSwePatchAuditMetrics,
  evaluateDeepSWEWithFlakeRerun,
  isTerminalCheckoutFailure,
  localCloneFailureShowsMirrorCorruption,
  removePatchPathsMissingFromBase,
  parseFailingP2PTestIds,
  repoMirrorDirectoryName,
  retryWithBackoff,
  synthesizeFlakeAwareVerdict,
  type DeepSWEReward,
  type DeepSWEVerifierInvocation,
  type DeepSWEVerifierResult,
  type FlakeVerifierRun,
} from './deepswe.js';

describe('DeepSWE graded patch audit metrics', () => {
  it('carries authoritative changed and newly added test-path disclosure', () => {
    const patch = [
      'diff --git a/src/value.ts b/src/value.ts',
      'diff --git a/tests/value.test.ts b/tests/value.test.ts',
      'diff --git a/pkg/value_test.go b/pkg/value_test.go',
    ].join('\n');

    expect(deepSwePatchAuditMetrics(
      patch,
      JSON.stringify({
        patchAudit: {
          gradedPatchTestPaths: 2,
          gradedPatchAddedTestPaths: 1,
          gradedPatchAddedTestPathList: ['tests/value.test.ts'],
          gradedPatchSha256: createHash('sha256').update(patch).digest('hex'),
        },
      }),
    )).toEqual({
      graded_patch_test_paths: 2,
      graded_patch_added_test_paths: 1,
      graded_patch_added_test_path_list: 'tests/value.test.ts',
    });
  });

  it('defaults malformed or absent audit metadata to zero', () => {
    expect(deepSwePatchAuditMetrics('', 'not json')).toEqual({
      graded_patch_test_paths: 0,
      graded_patch_added_test_paths: 0,
      graded_patch_added_test_path_list: '',
    });
  });

  it('uses the harness path count instead of reparsing unusual diff headers', () => {
    const patchWithQuotedHeader = 'diff --git "a/tests/a b.test.ts" "b/tests/a b.test.ts"\n';

    expect(deepSwePatchAuditMetrics(
      patchWithQuotedHeader,
      JSON.stringify({
        patchAudit: {
          gradedPatchTestPaths: 1,
          gradedPatchAddedTestPaths: 1,
          gradedPatchAddedTestPathList: ['tests/a b.test.ts'],
          gradedPatchSha256: createHash('sha256').update(patchWithQuotedHeader).digest('hex'),
        },
      }),
    )).toEqual({
      graded_patch_test_paths: 1,
      graded_patch_added_test_paths: 1,
      graded_patch_added_test_path_list: 'tests/a b.test.ts',
    });
  });

  it('ignores authoritative audit metadata captured for a different stored patch', () => {
    const patch = [
      'diff --git a/tests/new.test.ts b/tests/new.test.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tests/new.test.ts',
    ].join('\n');

    expect(deepSwePatchAuditMetrics(
      patch,
      JSON.stringify({
        patchAudit: {
          gradedPatchTestPaths: 99,
          gradedPatchAddedTestPaths: 99,
          gradedPatchAddedTestPathList: ['tests/wrong.test.ts'],
          gradedPatchSha256: createHash('sha256').update('different patch').digest('hex'),
        },
      }),
    )).toEqual({
      graded_patch_test_paths: 1,
      graded_patch_added_test_paths: 1,
      graded_patch_added_test_path_list: 'tests/new.test.ts',
    });
  });
});

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { encoding: 'utf-8' });
  return stdout;
}

async function createLocalGitRepository(root: string, name = 'remote'): Promise<{
  remotePath: string;
  commit: string;
}> {
  const remotePath = path.join(root, name);
  await fs.mkdir(remotePath);
  await git(['init', '--quiet', remotePath]);
  await git(['-C', remotePath, 'config', 'user.name', 'Omega Test']);
  await git(['-C', remotePath, 'config', 'user.email', 'omega@example.test']);
  await fs.writeFile(path.join(remotePath, 'tracked.txt'), 'from the cached commit\n', 'utf-8');
  await git(['-C', remotePath, 'add', 'tracked.txt']);
  await git(['-C', remotePath, 'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'initial']);
  const commit = (await git(['-C', remotePath, 'rev-parse', 'HEAD'])).trim();
  return { remotePath, commit };
}

async function corruptLooseObject(repositoryPath: string, objectId: string): Promise<void> {
  const objectPath = path.join(repositoryPath, 'objects', objectId.slice(0, 2), objectId.slice(2));
  // Local clones may hard-link loose objects. Break the link before corrupting
  // the mirror so the upstream fixture remains a healthy direct-clone source.
  await fs.unlink(objectPath);
  await fs.writeFile(objectPath, 'corrupt object\n', 'utf-8');
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

describe('DeepSWE repository mirror names', () => {
  it('is stable and contains only filesystem-safe characters', () => {
    const repoUrl = 'ssh://git@example.com:2222/team/a repo.git?ref=[main]';

    const first = repoMirrorDirectoryName(repoUrl);

    expect(repoMirrorDirectoryName(repoUrl)).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(first).not.toContain('..');
  });

  it('does not collide when distinct URLs have the same sanitised label', () => {
    const httpsUrl = 'https://example.com/team/repo.git';
    const sshUrl = 'ssh://example.com/team/repo.git';

    expect(repoMirrorDirectoryName(httpsUrl)).not.toBe(repoMirrorDirectoryName(sshUrl));
  });

  it('maps scheme, host, trailing slash, and .git aliases to one mirror', () => {
    const canonical = repoMirrorDirectoryName('https://example.com/team/participle');

    expect(repoMirrorDirectoryName('HTTPS://EXAMPLE.COM/team/participle.git')).toBe(canonical);
    expect(repoMirrorDirectoryName('https://example.com/team/participle.git/')).toBe(canonical);
    expect(repoMirrorDirectoryName('https://example.com/team/participle/')).toBe(canonical);
  });
});

describe('retryWithBackoff', () => {
  it('does not retry an operation that succeeds on its first attempt', async () => {
    const attempts: number[] = [];
    const sleeps: number[] = [];

    const result = await retryWithBackoff(
      async (attempt) => {
        attempts.push(attempt);
        return 'ok';
      },
      { sleep: async (milliseconds) => { sleeps.push(milliseconds); } },
    );

    expect(result).toBe('ok');
    expect(attempts).toEqual([1]);
    expect(sleeps).toEqual([]);
  });

  it('retries failures and can succeed on a later attempt with injected sleep', async () => {
    const attempts: number[] = [];
    const sleeps: number[] = [];

    const result = await retryWithBackoff(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error(`failure ${String(attempt)}`);
        return 'recovered';
      },
      {
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        delayMs: (failedAttempt) => failedAttempt * 10,
      },
    );

    expect(result).toBe('recovered');
    expect(attempts).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([10, 20]);
  });

  it('gives up after the configured attempt count and throws the last error', async () => {
    const errors = [new Error('first'), new Error('second'), new Error('last')];
    const sleeps: number[] = [];

    await expect(
      retryWithBackoff(
        async (attempt) => {
          throw errors[attempt - 1];
        },
        { maxAttempts: 3, sleep: async (milliseconds) => { sleeps.push(milliseconds); } },
      ),
    ).rejects.toBe(errors[2]);
    expect(sleeps).toEqual([2_000, 8_000]);
  });

  it('does not retry an error rejected by the retry classifier', async () => {
    const terminal = new Error('terminal');
    const operation = vi.fn().mockRejectedValue(terminal);
    const sleep = vi.fn();

    await expect(retryWithBackoff(operation, {
      shouldRetry: () => false,
      sleep,
    })).rejects.toBe(terminal);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('checkout failure classification', () => {
  it.each([
    ["error: pathspec 'missing-ref' did not match any file(s) known to git", true],
    ['fatal: ambiguous argument: unknown revision or path not in the working tree.', true],
    ['fatal: unable to read tree abc123', false],
    ['fatal: abc123 is not a tree object', false],
  ])('classifies direct checkout failure %s', (message, terminal) => {
    expect(isTerminalCheckoutFailure(new Error(message), 'direct')).toBe(terminal);
  });

  it.each([
    ['fatal: unable to read tree abc123', true],
    ['fatal: abc123 is not a tree object', true],
  ])('keeps strict mirror checkout classification for %s', (message, terminal) => {
    expect(isTerminalCheckoutFailure(new Error(message), 'mirror')).toBe(terminal);
  });
});

describe('local mirror clone corruption evidence', () => {
  it.each([
    ['fatal: loose object abc is corrupt', true],
    ['fatal: unable to read tree abc123', true],
    ['warning: Clone succeeded, but checkout failed.', true],
    ['fatal: unable to read current working directory: Permission denied', false],
    ['warning: Clone succeeded, but checkout failed: No space left on device', false],
    ['fatal: loose object abc is corrupt: Permission denied', true],
  ])('classifies %s', (message, corruptionEvidence) => {
    expect(localCloneFailureShowsMirrorCorruption(new Error(message))).toBe(corruptionEvidence);
  });
});

describe.sequential('cloneRepo mirror integration', () => {
  const originalCacheDir = process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR;
  const originalDisableCache = process.env.OMEGA_DEEPSWE_DISABLE_REPO_CACHE;
  const originalMinFreeGb = process.env.OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB;
  const originalCloneDeadline = process.env.OMEGA_DEEPSWE_CLONE_DEADLINE_MS;

  beforeEach(() => {
    process.env.OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB = '0';
    delete process.env.OMEGA_DEEPSWE_DISABLE_REPO_CACHE;
    delete process.env.OMEGA_DEEPSWE_CLONE_DEADLINE_MS;
  });

  afterEach(() => {
    restoreEnv('OMEGA_DEEPSWE_REPO_CACHE_DIR', originalCacheDir);
    restoreEnv('OMEGA_DEEPSWE_DISABLE_REPO_CACHE', originalDisableCache);
    restoreEnv('OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB', originalMinFreeGb);
    restoreEnv('OMEGA_DEEPSWE_CLONE_DEADLINE_MS', originalCloneDeadline);
    vi.restoreAllMocks();
  });

  it('creates a bare mirror, reuses it offline, and restores the upstream origin', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-clone-'));
    const remotePath = path.join(root, 'remote');
    const offlineRemotePath = path.join(root, 'remote-offline');
    const cacheDir = path.join(root, 'cache');
    const firstCheckout = path.join(root, 'checkout-one');
    const secondCheckout = path.join(root, 'checkout-two');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;

    try {
      const created = await createLocalGitRepository(root);
      expect(created.remotePath).toBe(remotePath);
      const { commit } = created;

      await cloneRepo(remotePath, commit, firstCheckout);

      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));
      expect((await fs.stat(mirrorPath)).isDirectory()).toBe(true);
      expect((await git(['-C', mirrorPath, 'rev-parse', '--is-bare-repository'])).trim()).toBe('true');
      expect((await git(['-C', firstCheckout, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect((await git(['-C', firstCheckout, 'remote', 'get-url', 'origin'])).trim()).toBe(remotePath);
      expect(log.mock.calls.flat().join('\n'))
        .toContain('source=fresh-mirror attempts=mirror-clone:1,local-clone:1');

      await fs.rename(remotePath, offlineRemotePath);
      log.mockClear();

      await cloneRepo(remotePath, commit, secondCheckout);

      expect((await git(['-C', secondCheckout, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect((await git(['-C', secondCheckout, 'remote', 'get-url', 'origin'])).trim()).toBe(remotePath);
      expect(log.mock.calls.flat().join('\n')).toContain('source=cache attempts=local-clone:1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses the direct fallback when the cache path throws', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-fallback-'));
    const cachePath = path.join(root, 'cache-is-a-file');
    const targetPath = path.join(root, 'checkout');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cachePath;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      await fs.writeFile(cachePath, 'not a directory\n', 'utf-8');

      await cloneRepo(remotePath, commit, targetPath);

      expect((await git(['-C', targetPath, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect(log.mock.calls.flat().join('\n')).toContain('source=direct-fallback');
      const warning = warn.mock.calls.flat().join('\n');
      expect(warning).toContain('reason=');
      expect(warning).toMatch(/EEXIST|ENOTDIR/);
      expect(warning).toContain(remotePath);
      expect(warning).toContain(path.join(cachePath, repoMirrorDirectoryName(remotePath)));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips mirror creation when OMEGA_DEEPSWE_DISABLE_REPO_CACHE=1', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-disabled-cache-'));
    const cacheDir = path.join(root, 'cache');
    const targetPath = path.join(root, 'checkout');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    process.env.OMEGA_DEEPSWE_DISABLE_REPO_CACHE = '1';
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);

      await cloneRepo(remotePath, commit, targetPath);

      await expect(fs.access(cacheDir)).rejects.toThrow();
      expect(log.mock.calls.flat().join('\n')).toContain('source=direct-fallback');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('quarantines a non-bare cache entry and rebuilds a correct mirror', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-corrupt-cache-'));
    const cacheDir = path.join(root, 'cache');
    const targetPath = path.join(root, 'checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const rename = vi.spyOn(fs, 'rename');
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));
      await fs.mkdir(mirrorPath, { recursive: true });
      await fs.writeFile(path.join(mirrorPath, 'foreign.txt'), 'not git\n', 'utf-8');

      await cloneRepo(remotePath, commit, targetPath);

      expect((await git(['-C', targetPath, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect((await git(['-C', mirrorPath, 'rev-parse', '--is-bare-repository'])).trim()).toBe('true');
      expect(warn.mock.calls.flat().join('\n')).toContain('non-bare');
      expect(log.mock.calls.flat().join('\n')).toContain('source=fresh-mirror');
      expect(rename.mock.calls.some(([from, to]) => (
        from === mirrorPath && String(to).startsWith(`${mirrorPath}.suspect-`)
      ))).toBe(true);
      expect((await fs.readdir(cacheDir)).some((entry) => entry.includes('.suspect-'))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('preserves a healthy mirror when an unrelated target failure breaks local clone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-target-failure-'));
    const cacheDir = path.join(root, 'cache');
    const initialTarget = path.join(root, 'first-checkout');
    const targetPath = path.join(root, 'second-checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      await cloneRepo(remotePath, commit, initialTarget);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));
      const mirrorIdentity = await fs.lstat(mirrorPath);
      const realRm = fs.rm.bind(fs);
      let targetBlocked = false;
      vi.spyOn(fs, 'rm').mockImplementation(async (filePath, options) => {
        await realRm(filePath, options);
        if (!targetBlocked && String(filePath) === targetPath) {
          targetBlocked = true;
          await fs.mkdir(targetPath);
          await fs.writeFile(path.join(targetPath, 'blocker'), 'force local clone failure\n', 'utf-8');
        }
      });

      await cloneRepo(remotePath, commit, targetPath);

      const retainedIdentity = await fs.lstat(mirrorPath);
      expect({ dev: retainedIdentity.dev, ino: retainedIdentity.ino })
        .toEqual({ dev: mirrorIdentity.dev, ino: mirrorIdentity.ino });
      expect((await git(['-C', mirrorPath, 'rev-parse', '--is-bare-repository'])).trim()).toBe('true');
      expect((await git(['-C', mirrorPath, 'cat-file', '-e', `${commit}^{commit}`])).trim()).toBe('');
      expect((await git(['-C', targetPath, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect(warn.mock.calls.flat().join('\n')).toContain('mirror probes are healthy; retaining mirror');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('invalidates a mirror whose blob graph is corrupt and succeeds via the healthy upstream', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-corrupt-blob-'));
    const cacheDir = path.join(root, 'cache');
    const firstTarget = path.join(root, 'first-checkout');
    const secondTarget = path.join(root, 'second-checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      await cloneRepo(remotePath, commit, firstTarget);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));
      const blobId = (await git(['-C', mirrorPath, 'rev-parse', `${commit}:tracked.txt`])).trim();
      await corruptLooseObject(mirrorPath, blobId);
      warn.mockClear();

      await cloneRepo(remotePath, commit, secondTarget);

      expect((await git(['-C', secondTarget, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      await expect(fs.access(mirrorPath)).rejects.toThrow();
      const warning = warn.mock.calls.flat().join('\n');
      expect(warning).toContain('invalidating mirror');
      expect(warning).toContain('corruptionEvidence=true');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('invalidates a mirror when the requested commit tree probe fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-corrupt-tree-'));
    const cacheDir = path.join(root, 'cache');
    const firstTarget = path.join(root, 'first-checkout');
    const secondTarget = path.join(root, 'second-checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      await cloneRepo(remotePath, commit, firstTarget);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));
      const treeId = (await git(['-C', mirrorPath, 'rev-parse', `${commit}^{tree}`])).trim();
      await corruptLooseObject(mirrorPath, treeId);

      const realRm = fs.rm.bind(fs);
      let targetBlocked = false;
      vi.spyOn(fs, 'rm').mockImplementation(async (filePath, options) => {
        await realRm(filePath, options);
        if (!targetBlocked && String(filePath) === secondTarget) {
          targetBlocked = true;
          await fs.mkdir(secondTarget);
          await fs.writeFile(path.join(secondTarget, 'blocker'), 'force local clone failure\n', 'utf-8');
        }
      });
      warn.mockClear();

      await cloneRepo(remotePath, commit, secondTarget);

      expect((await git(['-C', secondTarget, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      await expect(fs.access(mirrorPath)).rejects.toThrow();
      const warning = warn.mock.calls.flat().join('\n');
      expect(warning).toContain('invalidating mirror');
      expect(warning).toContain('hasTree=false');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('serialises concurrent mirror creation to one fresh mirror clone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-concurrent-cache-'));
    const cacheDir = path.join(root, 'cache');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const realMkdtemp = fs.mkdtemp.bind(fs);
    let mirrorCloneCount = 0;
    vi.spyOn(fs, 'mkdtemp').mockImplementation(async (prefix, options) => {
      if (prefix === path.join(cacheDir, '.mirror-tmp-')) {
        mirrorCloneCount += 1;
        await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
      }
      return realMkdtemp(prefix, options);
    });
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);

      await Promise.all([
        cloneRepo(remotePath, commit, path.join(root, 'checkout-one')),
        cloneRepo(remotePath, commit, path.join(root, 'checkout-two')),
      ]);

      const lines = log.mock.calls.flat().map(String);
      expect(mirrorCloneCount).toBe(1);
      expect(lines.filter((line) => line.includes('source=fresh-mirror'))).toHaveLength(1);
      expect(lines.filter((line) => line.includes('source=cache'))).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('pre-cleans an existing target checkout', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-preclean-'));
    const cacheDir = path.join(root, 'cache');
    const targetPath = path.join(root, 'checkout');
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      await fs.mkdir(targetPath);
      await fs.writeFile(path.join(targetPath, 'stale.txt'), 'stale\n', 'utf-8');

      await cloneRepo(remotePath, commit, targetPath);

      await expect(fs.access(path.join(targetPath, 'stale.txt'))).rejects.toThrow();
      expect((await git(['-C', targetPath, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses the direct path instead of creating a mirror below the free-space floor', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-low-space-'));
    const cacheDir = path.join(root, 'cache');
    const targetPath = path.join(root, 'checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    process.env.OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB = '999999999';
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));

      await cloneRepo(remotePath, commit, targetPath);

      await expect(fs.access(mirrorPath)).rejects.toThrow();
      expect((await git(['-C', targetPath, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      const floorWarnings = warn.mock.calls.flat().map(String).filter((line) => (
        line.includes('repo cache free-space floor stopped mirror')
      ));
      expect(floorWarnings).toHaveLength(1);
      expect(floorWarnings[0]).toContain('phase=create');
      expect(floorWarnings[0]).toMatch(/free_gib=\d+\.\d{2}/);
      expect(floorWarnings[0]).toContain('floor_gib=999999999');
      expect(warn.mock.calls.flat().join('\n')).not.toContain('repo cache unavailable');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('proceeds with mirror creation when the free-space probe throws', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-statfs-failure-'));
    const cacheDir = path.join(root, 'cache');
    const targetPath = path.join(root, 'checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(fs, 'statfs').mockRejectedValueOnce(new Error('statfs unavailable'));
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));

      await cloneRepo(remotePath, commit, targetPath);

      expect((await git(['-C', targetPath, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect((await git(['-C', mirrorPath, 'rev-parse', '--is-bare-repository'])).trim()).toBe('true');
      const warning = warn.mock.calls.flat().join('\n');
      expect(warning).toContain('repo cache free-space check unavailable; proceeding');
      expect(warning).toContain('phase=create');
      expect(warning).not.toContain('repo cache unavailable; using direct fallback');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips a mirror fetch below the free-space floor and uses the direct path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-low-space-fetch-'));
    const cacheDir = path.join(root, 'cache');
    const firstTarget = path.join(root, 'first-checkout');
    const secondTarget = path.join(root, 'second-checkout');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit: firstCommit } = await createLocalGitRepository(root);
      await cloneRepo(remotePath, firstCommit, firstTarget);
      const mirrorPath = path.join(cacheDir, repoMirrorDirectoryName(remotePath));

      await fs.writeFile(path.join(remotePath, 'tracked.txt'), 'a newer upstream commit\n', 'utf-8');
      await git(['-C', remotePath, 'add', 'tracked.txt']);
      await git(['-C', remotePath, 'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'second']);
      const secondCommit = (await git(['-C', remotePath, 'rev-parse', 'HEAD'])).trim();
      process.env.OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB = '999999999';
      warn.mockClear();

      await cloneRepo(remotePath, secondCommit, secondTarget);

      expect((await git(['-C', secondTarget, 'rev-parse', 'HEAD'])).trim()).toBe(secondCommit);
      await expect(git(['-C', mirrorPath, 'cat-file', '-e', `${secondCommit}^{commit}`])).rejects.toThrow();
      const floorWarnings = warn.mock.calls.flat().map(String).filter((line) => (
        line.includes('repo cache free-space floor stopped mirror')
      ));
      expect(floorWarnings).toHaveLength(1);
      expect(floorWarnings[0]).toContain('phase=fetch');
      expect(floorWarnings[0]).toMatch(/free_gib=\d+\.\d{2}/);
      expect(floorWarnings[0]).toContain('floor_gib=999999999');
      expect(warn.mock.calls.flat().join('\n')).not.toContain('repo cache unavailable');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('reuses an existing healthy mirror even below the new-mirror free-space floor', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-low-space-reuse-'));
    const cacheDir = path.join(root, 'cache');
    const firstTarget = path.join(root, 'first-checkout');
    const secondTarget = path.join(root, 'second-checkout');
    const offlineRemote = path.join(root, 'remote-offline');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);
      await cloneRepo(remotePath, commit, firstTarget);
      await fs.rename(remotePath, offlineRemote);
      process.env.OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB = '999999999';
      log.mockClear();

      await cloneRepo(remotePath, commit, secondTarget);

      expect((await git(['-C', secondTarget, 'rev-parse', 'HEAD'])).trim()).toBe(commit);
      expect(log.mock.calls.flat().join('\n')).toContain('source=cache');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails fast without direct fallback when the mirror cannot fetch the requested commit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-missing-commit-'));
    const cacheDir = path.join(root, 'cache');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = cacheDir;
    try {
      const { remotePath } = await createLocalGitRepository(root);

      await expect(cloneRepo(remotePath, '0000000000000000000000000000000000000000', path.join(root, 'checkout')))
        .rejects.toThrow('does not contain requested commit');

      expect(log.mock.calls.flat().join('\n')).not.toContain('source=direct-fallback');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not retry a terminal checkout failure on the direct path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-terminal-checkout-'));
    const targetPath = path.join(root, 'checkout');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.OMEGA_DEEPSWE_DISABLE_REPO_CACHE = '1';
    try {
      const { remotePath } = await createLocalGitRepository(root);

      await expect(cloneRepo(remotePath, 'definitely-missing-ref', targetPath))
        .rejects.toThrow('cannot resolve commit');

      expect(log.mock.calls.flat().join('\n')).toContain('attempts=direct-clone:1 failed=true');
      await expect(fs.access(targetPath)).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('enforces the overall clone deadline while a filesystem preflight is stalled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-deadline-'));
    process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR = path.join(root, 'cache');
    process.env.OMEGA_DEEPSWE_CLONE_DEADLINE_MS = '25';
    vi.spyOn(fs, 'statfs').mockImplementation(async () => new Promise(() => undefined));
    try {
      const { remotePath, commit } = await createLocalGitRepository(root);

      await expect(cloneRepo(remotePath, commit, path.join(root, 'checkout')))
        .rejects.toThrow('clone deadline exceeded after 25ms');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 5_000);
});

describe('local verifier rerun preparation', () => {
  it('removes only model-patch paths absent from base so an added file can be applied again', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-deepswe-rerun-'));
    const patchFile = path.join(root, 'model.patch');
    const addedFile = path.join(root, 'added.txt');
    try {
      await git(['init', '--quiet', root]);
      await git(['-C', root, 'config', 'user.name', 'Omega Test']);
      await git(['-C', root, 'config', 'user.email', 'omega@example.test']);
      await fs.writeFile(path.join(root, 'tracked.txt'), 'base\n', 'utf-8');
      await git(['-C', root, 'add', 'tracked.txt']);
      await git(['-C', root, 'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'base']);
      const baseCommit = (await git(['-C', root, 'rev-parse', 'HEAD'])).trim();
      await fs.writeFile(patchFile, [
        'diff --git a/tracked.txt b/tracked.txt',
        '--- a/tracked.txt',
        '+++ b/tracked.txt',
        '@@ -1 +1 @@',
        '-base',
        '+changed',
        'diff --git a/added.txt b/added.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/added.txt',
        '@@ -0,0 +1 @@',
        '+added',
        '',
      ].join('\n'), 'utf-8');

      await git(['-C', root, 'apply', patchFile]);
      await git(['-C', root, 'checkout', '-f', baseCommit]);
      expect(await fs.readFile(addedFile, 'utf-8')).toBe('added\n');

      expect(await removePatchPathsMissingFromBase(root, baseCommit, patchFile)).toBe(1);

      await expect(fs.access(addedFile)).rejects.toThrow();
      expect(await fs.readFile(path.join(root, 'tracked.txt'), 'utf-8')).toBe('base\n');
      await expect(git(['-C', root, 'apply', '--check', patchFile])).resolves.toBe('');
      expect(await removePatchPathsMissingFromBase(root, baseCommit, patchFile)).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

});

describe('parseFailingP2PTestIds', () => {
  it('parses real verifier lines without truncating spaces, brackets, slashes, or ::', () => {
    const first = 'tests/test script.py::test_case[param with spaces/[nested]]';
    const second = 'github.com/acme/repo/pkg.TestThing/sub case [left::right]';
    const logs = [
      '=== test.sh stdout ===',
      `[verifier] ✗ [p2p] ${first}`,
      '[verifier] ✗ [f2p] tests/new_test.py::test_feature[value]',
      `[verifier] ✗ [p2p] ${second}\r`,
      `[verifier] ✗ [p2p] ${first}`,
      '=== test.sh stderr ===',
    ].join('\n');

    expect(parseFailingP2PTestIds(logs)).toEqual([first, second]);
  });

  it('ignores near-matches that are not grader p2p failure lines', () => {
    expect(parseFailingP2PTestIds([
      '[verifier] ✓ [p2p] tests/a.py::test_ok',
      'prefix [verifier] ✗ [p2p] tests/b.py::test_prefixed',
      '[verifier] ✗ [f2p] tests/c.py::test_feature',
    ].join('\n'))).toEqual([]);
  });
});

const eligibleReward: DeepSWEReward = {
  reward: 0,
  f2p_total: 10,
  f2p_passed: 10,
  p2p_total: 100,
  p2p_passed: 99,
  partial: 0.99,
};

describe('decideFlakeRerun', () => {
  it('allows a failed near-miss with complete f2p', () => {
    expect(decideFlakeRerun({ reward: eligibleReward, timedOut: false })).toEqual({ shouldRerun: true });
  });

  it.each([
    ['disabled', { disabled: true }],
    ['the first verifier passed', { reward: { ...eligibleReward, reward: 1 } }],
    ['the verifier timed out', { timedOut: true }],
    ['the patch failed to apply', { reward: { ...eligibleReward, apply_failed: true } }],
    ['f2p is incomplete', { reward: { ...eligibleReward, f2p_passed: 9 } }],
    ['there is no f2p evidence', { reward: { ...eligibleReward, f2p_total: 0, f2p_passed: 0 } }],
  ])('declines when %s', (_label, override) => {
    const decision = decideFlakeRerun({ reward: eligibleReward, timedOut: false, ...override });

    expect(decision.shouldRerun).toBe(false);
    if (decision.shouldRerun) throw new Error('expected the flake re-run gate to decline');
    expect(decision.skippedReason).toBeTruthy();
  });

  it('enforces the absolute failure cap at its boundary', () => {
    const atCap = { ...eligibleReward, p2p_total: 1_000, p2p_passed: 997 };
    const overCap = { ...atCap, p2p_passed: 996 };

    expect(decideFlakeRerun({ reward: atCap, timedOut: false, maxP2PFailures: 3 }).shouldRerun).toBe(true);
    expect(decideFlakeRerun({ reward: overCap, timedOut: false, maxP2PFailures: 3 }).shouldRerun).toBe(false);
  });

  it.each([
    [6, 1, 2],
    [49, 1, 2],
    [50, 1, 2],
    [150, 3, 4],
  ])('uses the percentage floor/cap at p2p_total=%i', (total, allowed, rejected) => {
    const reward = { ...eligibleReward, p2p_total: total, p2p_passed: total - allowed };
    const overCap = { ...reward, p2p_passed: total - rejected };

    expect(decideFlakeRerun({ reward, timedOut: false }).shouldRerun).toBe(true);
    expect(decideFlakeRerun({ reward: overCap, timedOut: false }).shouldRerun).toBe(false);
  });

  it('declines when there is no positive p2p shortfall to confirm', () => {
    const noP2PFailure = { ...eligibleReward, p2p_passed: eligibleReward.p2p_total };

    expect(decideFlakeRerun({ reward: noP2PFailure, timedOut: false }).shouldRerun).toBe(false);
  });
});

function verifierRun(
  failingP2PTests: string[],
  rewardOverrides: Partial<DeepSWEReward> = {},
  runOverrides: Partial<FlakeVerifierRun> = {},
): FlakeVerifierRun {
  const reward: DeepSWEReward = {
    reward: failingP2PTests.length === 0 ? 1 : 0,
    f2p_total: 10,
    f2p_passed: 10,
    p2p_total: 100,
    p2p_passed: 100 - failingP2PTests.length,
    partial: (110 - failingP2PTests.length) / 110,
    ...rewardOverrides,
  };
  return {
    reward,
    timedOut: false,
    verifierMode: 'local',
    failingP2PTests,
    ...runOverrides,
  };
}

describe('synthesizeFlakeAwareVerdict', () => {
  it('passes when every p2p failure is flaky across the two verifier runs', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['tests/a.py::test_one']),
      rerun: verifierRun(['tests/b.py::test_two']),
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.flakyTests).toEqual(['tests/a.py::test_one', 'tests/b.py::test_two']);
    expect(verdict.confirmedFailingTests).toEqual([]);
    expect(verdict.originalVerdictRetained).toBe(false);
    expect(verdict.p2pRerunFailureDisjoint).toBe(true);
  });

  it('passes without the disjoint-failure disclosure when the rerun has zero p2p failures', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['tests/a.py::test_one']),
      rerun: verifierRun([]),
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.p2pRerunFailureDisjoint).toBe(false);
  });

  it('keeps the original verdict when verifier environments differ', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['tests/a.py::test_one'], {}, { verifierMode: 'local' }),
      rerun: verifierRun([], {}, { verifierMode: 'docker' }),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toBe('first run and flake re-run used different verifier environments');
  });

  it('fails when a p2p failure is confirmed in both runs', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['confirmed', 'first-only']),
      rerun: verifierRun(['confirmed', 'rerun-only']),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.flakyTests).toEqual(['first-only', 'rerun-only']);
    expect(verdict.confirmedFailingTests).toEqual(['confirmed']);
  });

  it.each([
    ['crashed', { error: 'verifier crashed', failingP2PTests: [] }],
    ['timed out', { reward: eligibleReward, timedOut: true, failingP2PTests: ['rerun'] }],
    ['has no reward', { failingP2PTests: [] }],
    [
      'failed without parseable p2p lines',
      {
        reward: { ...eligibleReward, f2p_passed: 9, p2p_passed: 100 },
        timedOut: false,
        failingP2PTests: [],
      },
    ],
  ])('keeps the original verdict when the rerun %s', (_label, rerun) => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['original']),
      rerun,
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toBeTruthy();
  });

  it('keeps the original verdict when run-one parsed failures disagree with its numeric shortfall', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['only-parsed-failure'], { p2p_passed: 98 }),
      rerun: verifierRun([]),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toContain('run 1');
    expect(verdict.reason).toContain('reward shortfall=2');
    expect(verdict.reason).toContain('parsed=1');
  });

  it('keeps the original verdict when rerun parsed failures disagree with its numeric shortfall', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['first-only']),
      rerun: verifierRun(['one-parsed'], { p2p_passed: 98 }),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toContain('re-run');
  });

  it('keeps the original verdict when the two runs grade different test totals', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['first-only']),
      rerun: verifierRun([], { p2p_total: 101, p2p_passed: 101 }),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toContain('totals');
  });

  it('requires f2p to be complete in both runs', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun(['first-only']),
      rerun: verifierRun(['rerun-only'], { f2p_passed: 9 }),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toContain('f2p');
  });

  it('never forgives a reward-zero first run with no p2p shortfall', () => {
    const verdict = synthesizeFlakeAwareVerdict({
      originalPassed: false,
      firstRun: verifierRun([], { reward: 0 }),
      rerun: verifierRun([]),
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.originalVerdictRetained).toBe(true);
    expect(verdict.reason).toContain('no p2p shortfall');
  });
});

function deepSWEVerifierResult(
  reward: DeepSWEReward,
  gradingLogs: string,
  overrides: Partial<DeepSWEVerifierResult> = {},
): DeepSWEVerifierResult {
  return {
    reward,
    logs: gradingLogs,
    gradingLogs,
    verifierMode: 'local',
    logFile: '/tmp/deepswe-verifier.log',
    exitCode: 0,
    timedOut: false,
    appliedEnvironmentOverrides: [],
    patchPathsCleanedCount: 0,
    ...overrides,
  };
}

const verifierInvocation: DeepSWEVerifierInvocation = {
  projectPath: '/same/project',
  taskDir: '/tasks/example',
  baseCommit: 'base-commit',
  useDocker: false,
  taskName: 'example-task',
  modelPatch: 'diff --git a/a b/a\n',
};

function flakeEvaluationInput(
  environment: NodeJS.ProcessEnv = {},
  budget = createFlakeRerunBudget(environment),
) {
  return { invocation: verifierInvocation, environment, rerunBudget: budget };
}

describe('createFlakeRerunBudget', () => {
  it('uses a non-binding 1024-confirmation default for a normal sweep', () => {
    const budget = createFlakeRerunBudget({});

    expect(Array.from({ length: 1_024 }, () => budget.acquire()))
      .toEqual(Array.from({ length: 1_024 }, () => ({ acquired: true })));
    expect(budget.acquire()).toEqual({
      acquired: false,
      skippedReason: 'sweep-level flake re-run budget exhausted (1024/1024)',
    });
  });

  it('allows an explicit zero-confirmation budget', () => {
    expect(createFlakeRerunBudget({ OMEGA_DEEPSWE_FLAKE_MAX_RERUNS: '0' }).acquire())
      .toEqual({
        acquired: false,
        skippedReason: 'sweep-level flake re-run budget exhausted (0/0)',
      });
  });
});

describe('evaluateDeepSWEWithFlakeRerun', () => {
  it('runs one same-tree confirmation and takes passed from synthesis', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/a.py::test_flaky',
        { patchPathsCleanedCount: 1 },
      ))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        { ...eligibleReward, reward: 1, p2p_passed: 100, partial: 1 },
        '',
        { patchPathsCleanedCount: 2 },
      ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0]).toEqual(verifierInvocation);
    expect(runner.mock.calls[1]?.[0]).toEqual(verifierInvocation);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics).toMatchObject({
      flake_rerun: 1,
      flake_forgiven_pass: 1,
      verifier_mode: 'local',
      verifier_mode_rerun: 'local',
      patch_paths_cleaned_count: 1,
      patch_paths_cleaned_count_rerun: 2,
    });
    expect(evaluation.metrics).not.toHaveProperty('p2p_rerun_failure_disjoint');
  });

  it('does not forgive a pass manufactured by a verifier-mode change', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/a.py::test_host_environment',
        { verifierMode: 'local' },
      ))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        { ...eligibleReward, reward: 1, p2p_passed: 100, partial: 1 },
        '',
        { verifierMode: 'docker' },
      ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics).toMatchObject({
      verifier_mode: 'local',
      verifier_mode_rerun: 'docker',
      flake_rerun_skipped_reason:
        'first run and flake re-run used different verifier environments',
    });
    expect(evaluation.metrics).not.toHaveProperty('flake_forgiven_pass');
  });

  it('discloses a forgiven pass reached through disjoint non-empty failure sets', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/a.py::test_first',
      ))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/b.py::test_rerun',
      ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics).toMatchObject({
      flake_forgiven_pass: 1,
      p2p_rerun_failure_disjoint: 1,
    });
    expect(evaluation.message).toContain('p2p_rerun_failure_disjoint');
  });

  it('parses grading evidence from the full untruncated log', async () => {
    const fullLog = `[verifier] ✗ [p2p] tests/a.py::test_early\n${'tail'.repeat(2_000)}`;
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, fullLog, { logs: fullLog.slice(-4096) }))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        { ...eligibleReward, reward: 1, p2p_passed: 100, partial: 1 },
        '',
      ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics?.flake_forgiven_pass).toBe(1);
  });

  it.each([
    ['disable switch', { OMEGA_DEEPSWE_DISABLE_FLAKE_RERUN: '1' }],
    ['absolute cap switch', { OMEGA_DEEPSWE_FLAKE_MAX_P2P_FAILURES: '0' }],
  ])('does not confirm when blocked by the %s', async (_label, environment) => {
    const runner = vi.fn().mockResolvedValue(deepSWEVerifierResult(
      eligibleReward,
      '[verifier] ✗ [p2p] tests/a.py::test_fail',
    ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(environment), runner);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics?.flake_rerun_skipped_reason).toBeTruthy();
    expect(evaluation.metrics).not.toHaveProperty('flake_forgiven_pass');
    expect(evaluation.metrics).not.toHaveProperty('flake_rerun_synthesis_skipped_reason');
  });

  it('lets a spoofed raw-output p2p line trip the count valve and never flip the verdict', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/a.py::test_real\n[verifier] ✗ [p2p] fake',
      ))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        { ...eligibleReward, reward: 1, p2p_passed: 100, partial: 1 },
        '',
      ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics?.flake_rerun_skipped_reason).toContain('parser/count mismatch');
    expect(evaluation.metrics).not.toHaveProperty('flake_forgiven_pass');
  });

  it('lets a rerun-side spoof trip the count valve and never flip the verdict', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/a.py::test_real',
      ))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        eligibleReward,
        '[verifier] ✗ [p2p] tests/b.py::test_real\n[verifier] ✗ [p2p] fake',
      ));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics?.flake_rerun_skipped_reason).toContain('re-run p2p parser/count mismatch');
    expect(evaluation.metrics).not.toHaveProperty('flake_forgiven_pass');
  });

  it('never downgrades an original pass or consumes rerun budget for it', async () => {
    const environment = { OMEGA_DEEPSWE_FLAKE_MAX_RERUNS: '1' };
    const budget = createFlakeRerunBudget(environment);
    const passingReward = { ...eligibleReward, reward: 1, p2p_passed: 100, partial: 1 };
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(passingReward, ''))
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, '[verifier] ✗ [p2p] later'))
      .mockResolvedValueOnce(deepSWEVerifierResult(passingReward, ''));

    const originalPass = await evaluateDeepSWEWithFlakeRerun(
      flakeEvaluationInput(environment, budget),
      runner,
    );
    const laterNearMiss = await evaluateDeepSWEWithFlakeRerun(
      flakeEvaluationInput(environment, budget),
      runner,
    );

    expect(originalPass.passed).toBe(true);
    expect(originalPass.metrics?.flake_rerun).toBe(0);
    expect(originalPass.metrics).not.toHaveProperty('flake_forgiven_pass');
    expect(originalPass.metrics).not.toHaveProperty('patch_paths_cleaned_count');
    expect(laterNearMiss.passed).toBe(true);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('keeps a confirmed p2p failure failed without a forgiven-pass marker', async () => {
    const failureLine = '[verifier] ✗ [p2p] tests/a.py::test_confirmed';
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, failureLine))
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, failureLine));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics?.p2p_confirmed_failing_count).toBe(1);
    expect(evaluation.metrics).not.toHaveProperty('flake_forgiven_pass');
  });

  it('shares a per-suite budget and stops the N+1 confirmation', async () => {
    const environment = { OMEGA_DEEPSWE_FLAKE_MAX_RERUNS: '1' };
    const budget = createFlakeRerunBudget(environment);
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, '[verifier] ✗ [p2p] first'))
      .mockResolvedValueOnce(deepSWEVerifierResult(
        { ...eligibleReward, reward: 1, p2p_passed: 100, partial: 1 },
        '',
      ))
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, '[verifier] ✗ [p2p] second'));

    const first = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(environment, budget), runner);
    const second = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(environment, budget), runner);

    expect(first.passed).toBe(true);
    expect(second.passed).toBe(false);
    expect(runner).toHaveBeenCalledTimes(3);
    expect(second.metrics?.flake_rerun_skipped_reason).toContain('budget exhausted');
  });

  it.each([
    ['timed out', deepSWEVerifierResult(eligibleReward, '', { timedOut: true })],
    ['failed to apply', deepSWEVerifierResult({ ...eligibleReward, apply_failed: true }, '')],
  ])('keeps rerun %s detail out of the message and classifies the first failure as test_failure', async (
    _label,
    rerunResult,
  ) => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, '[verifier] ✗ [p2p] first'))
      .mockResolvedValueOnce(rerunResult);
    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);
    const result: BenchmarkResult = {
      task: { id: 'task', name: 'task', title: 'task', evaluate: () => evaluation },
      harnessTaskId: 'harness-task',
      durationMs: 1,
      status: 'failed',
      evaluation,
      spanCount: 0,
    };

    expect(evaluation.message).toContain('flake re-run inconclusive');
    expect(evaluation.message).not.toMatch(/timed out|failed to apply|does not apply/i);
    expect(evaluation.metrics?.flake_rerun_skipped_reason).toBeTruthy();
    expect(evaluation.metrics).not.toHaveProperty('flake_rerun_synthesis_skipped_reason');
    expect(classifyFailure(result).category).toBe('test_failure');
  });

  it('keeps a thrown rerun apply detail only in the unified metric', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(deepSWEVerifierResult(eligibleReward, '[verifier] ✗ [p2p] first'))
      .mockRejectedValueOnce(new Error('patch does not apply during confirmation'));

    const evaluation = await evaluateDeepSWEWithFlakeRerun(flakeEvaluationInput(), runner);
    const result: BenchmarkResult = {
      task: { id: 'task', name: 'task', title: 'task', evaluate: () => evaluation },
      harnessTaskId: 'harness-task',
      durationMs: 1,
      status: 'failed',
      evaluation,
      spanCount: 0,
    };

    expect(evaluation.message).not.toContain('does not apply');
    expect(evaluation.metrics?.flake_rerun_skipped_reason).toContain('does not apply');
    expect(evaluation.metrics).not.toHaveProperty('flake_rerun_synthesis_skipped_reason');
    expect(classifyFailure(result).category).toBe('test_failure');
  });
});
