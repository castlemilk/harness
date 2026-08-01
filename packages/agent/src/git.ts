import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitResult {
  success: boolean;
  output: string;
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

function isExcludedDiffPath(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  return EXCLUDED_DIFF_PATHS.some(
    (excluded) => normalised === excluded || normalised.startsWith(`${excluded}/`)
  );
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
        '.',
        ':!pnpm-lock.yaml',
        ':!yarn.lock',
        ':!package-lock.json',
        ':!node_modules',
        ':!.omega',
      ]
    : ['diff', '--', '.', ':!pnpm-lock.yaml', ':!yarn.lock', ':!package-lock.json', ':!node_modules', ':!.omega'];
  // Preserve exact patch bytes; trimming trailing whitespace corrupts patches.
  return git(projectPath, args, { trim: false });
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
