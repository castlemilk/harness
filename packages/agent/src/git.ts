import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isSpecGateTestPath, isTestishPath } from '@omega/core';

const execFileAsync = promisify(execFile);

export interface GitResult {
  success: boolean;
  output: string;
}

export interface GradedDiffResult extends GitResult {
  specGatePathsRemoved: string[];
  gradedPatchTestPaths: string[];
  /** Diagnostic text is kept separate so callers can never persist it as a patch. */
  error?: string;
}

async function git(
  projectPath: string,
  args: string[],
  options: { timeout?: number; trim?: boolean } = {}
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: projectPath,
      timeout: options.timeout ?? 30_000,
      // Node's 1 MiB default silently kills the child, which for a diff means
      // the agent's patch is dropped rather than truncated. A large patch is
      // ordinary on these repos.
      maxBuffer: 64 * 1024 * 1024,
    });
    const shouldTrim = options.trim ?? true;
    const out = shouldTrim ? stdout.trim() + stderr.trim() : stdout + stderr;
    return { success: true, output: out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: message };
  }
}

export async function getCurrentBranch(projectPath: string): Promise<GitResult> {
  return git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function getCurrentCommit(projectPath: string): Promise<GitResult> {
  return git(projectPath, ['rev-parse', 'HEAD']);
}

export async function createBranch(
  projectPath: string,
  branchName: string,
  base?: string
): Promise<GitResult> {
  const args = ['checkout', '-b', branchName];
  if (base) args.push(base);
  return git(projectPath, args);
}

export async function checkoutBranch(projectPath: string, branchName: string): Promise<GitResult> {
  return git(projectPath, ['checkout', branchName]);
}

export async function stageAll(projectPath: string): Promise<GitResult> {
  return git(projectPath, ['add', '.']);
}

const EXCLUDED_DIFF_PATHS = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'node_modules', '.omega'];
/**
 * `E2BIG` is a byte limit (ARG_MAX ≈ 1 MiB), not a count, and each exclusion
 * costs roughly a path's length plus 18 bytes of `:(exclude,literal)`. 4000 is
 * the measured headroom for corpus-shaped paths with a wide margin; a task with
 * more marker files than this is pathological, not ordinary.
 */
const MAX_GRADED_DIFF_PATHSPEC_EXCLUSIONS = 4000;

function diffPathspecs(extraExclusions: string[] = []): string[] {
  return [
    '.',
    ...EXCLUDED_DIFF_PATHS.map((filePath) => `:(exclude,literal)${filePath}`),
    ...extraExclusions.map((filePath) => `:(exclude,literal)${filePath}`),
  ];
}

function isExcludedDiffPath(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  return EXCLUDED_DIFF_PATHS.some(
    (excluded) => normalised === excluded || normalised.startsWith(`${excluded}/`)
  );
}

function failedGradedDiff(
  result: GitResult,
  specGatePathsRemoved: string[] = [],
  gradedPatchTestPaths: string[] = [],
): GradedDiffResult {
  return {
    success: false,
    output: '',
    error: result.output,
    specGatePathsRemoved,
    gradedPatchTestPaths,
  };
}

export async function getChangedFiles(projectPath: string): Promise<string[]> {
  // Do NOT trim: porcelain lines begin with a significant two-character status
  // code and a separating space; trimming strips the leading space and shifts
  // the filename offset.
  const { success, output } = await git(projectPath, ['status', '--porcelain'], { trim: false });
  if (!success) return [];
  return output
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((f) => f.length > 0 && !isExcludedDiffPath(f));
}

export async function stageFiles(projectPath: string, files: string[]): Promise<GitResult> {
  const toStage = files.filter((f) => !isExcludedDiffPath(f));
  if (toStage.length === 0) return { success: true, output: 'no files to stage' };
  return git(projectPath, ['add', '--', ...toStage]);
}

export async function stageAllChanges(projectPath: string): Promise<GitResult> {
  const files = await getChangedFiles(projectPath);
  return stageFiles(projectPath, files);
}

export async function commit(projectPath: string, message: string, noVerify = false): Promise<GitResult> {
  const args = ['commit', '-m', message];
  if (noVerify) args.push('--no-verify');
  return git(projectPath, args);
}

export async function getDiff(projectPath: string, base?: string): Promise<GitResult> {
  // When a base commit is supplied we want all changes that have been committed
  // on top of it (the canonical patch for the task). Without a base we fall back
  // to uncommitted working-tree changes.
  const args = base
    ? [
        'diff',
        base,
        'HEAD',
        '--',
        ...diffPathspecs(),
      ]
    : ['diff', '--', ...diffPathspecs()];
  // Preserve exact patch bytes; trimming trailing whitespace corrupts patches.
  return git(projectPath, args, { trim: false });
}

export async function getGradedDiff(projectPath: string, base: string): Promise<GradedDiffResult> {
  const changed = await git(
    projectPath,
    ['diff', '--name-only', '-z', base, 'HEAD', '--', ...diffPathspecs()],
    { trim: false },
  );
  if (!changed.success) {
    return failedGradedDiff(changed);
  }
  const changedPaths = changed.output.split('\0').filter(Boolean);
  const markerPaths = changedPaths.filter(isSpecGateTestPath).sort();
  // Above the cap we grade the patch UNSTRIPPED rather than risk the diff.
  // Textually re-splitting a patch to drop sections is not safe — a typechange
  // (symlink replaced by a regular file) emits two `diff --git` sections for
  // one changed path — and a mis-split patch is a silent zero. Degrading to
  // "strip nothing, disclose everything" keeps the agent's work intact; the
  // marker files then show up in gradedPatchTestPaths, which is the truth.
  const overCap = markerPaths.length > MAX_GRADED_DIFF_PATHSPEC_EXCLUSIONS;
  if (overCap) {
    console.warn(
      `[git] ${String(markerPaths.length)} spec-gate marker paths exceeds the ` +
        `${String(MAX_GRADED_DIFF_PATHSPEC_EXCLUSIONS)} pathspec cap; grading the patch unstripped`,
    );
  }
  const specGatePathsRemoved = overCap ? [] : markerPaths;
  const gradedPatchTestPaths = changedPaths
    .filter((filePath) => !specGatePathsRemoved.includes(filePath) && (isSpecGateTestPath(filePath) || isTestishPath(filePath)))
    .sort();
  const patch = await git(
    projectPath,
    ['diff', base, 'HEAD', '--', ...diffPathspecs(specGatePathsRemoved)],
    { trim: false },
  );
  if (!patch.success) {
    return failedGradedDiff(patch, specGatePathsRemoved, gradedPatchTestPaths);
  }
  return { ...patch, specGatePathsRemoved, gradedPatchTestPaths };
}

export async function hasChanges(projectPath: string): Promise<boolean> {
  const result = await git(projectPath, ['status', '--porcelain']);
  return result.success && result.output.trim().length > 0;
}

export async function stashAll(projectPath: string, message = 'omega-agent-stash'): Promise<GitResult> {
  return git(projectPath, ['stash', 'push', '-u', '-m', message]);
}

export async function popStash(projectPath: string): Promise<GitResult> {
  return git(projectPath, ['stash', 'pop']);
}

export async function createTag(projectPath: string, tag: string, message?: string): Promise<GitResult> {
  const args = message ? ['tag', '-a', tag, '-m', message] : ['tag', tag];
  return git(projectPath, args);
}

export async function push(projectPath: string, remote = 'origin', ref?: string): Promise<GitResult> {
  const args = ['push', remote];
  if (ref) args.push(ref);
  return git(projectPath, args, { timeout: 60_000 });
}

export async function createWorktree(
  projectPath: string,
  worktreePath: string,
  branchName: string,
  base?: string
): Promise<GitResult> {
  const args = ['worktree', 'add', '-b', branchName, worktreePath];
  if (base) args.push(base);
  return git(projectPath, args, { timeout: 60_000 });
}

export async function removeWorktree(projectPath: string, worktreePath: string): Promise<GitResult> {
  return git(projectPath, ['worktree', 'remove', '--force', worktreePath], { timeout: 60_000 });
}

export async function listWorktrees(projectPath: string): Promise<GitResult> {
  return git(projectPath, ['worktree', 'list', '--porcelain']);
}

/**
 * Delete every local branch in `projectPath` except `branchName`.
 * Used after creating an isolated worktree so the agent cannot accidentally
 * checkout a pre-existing solution/feature branch.
 */
export async function deleteOtherLocalBranches(
  projectPath: string,
  branchName: string
): Promise<GitResult> {
  const branches = await git(projectPath, ['branch', '--format=%(refname:short)']);
  if (!branches.success) return branches;
  const names = branches.output
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && b !== branchName);
  if (names.length === 0) return { success: true, output: 'no other branches' };
  const result = await git(projectPath, ['branch', '-D', ...names]);
  return result;
}
