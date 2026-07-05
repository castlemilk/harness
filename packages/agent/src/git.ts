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
  options: { timeout?: number } = {}
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: projectPath,
      timeout: options.timeout ?? 30_000,
    });
    return { success: true, output: stdout.trim() + stderr.trim() };
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

export async function stageFiles(projectPath: string, files: string[]): Promise<GitResult> {
  const toStage = files.filter((f) => !isExcludedDiffPath(f));
  if (toStage.length === 0) return { success: true, output: 'no files to stage' };
  return git(projectPath, ['add', '--', ...toStage]);
}

export async function commit(projectPath: string, message: string): Promise<GitResult> {
  return git(projectPath, ['commit', '-m', message]);
}

export async function getDiff(projectPath: string, base?: string): Promise<GitResult> {
  const args = base
    ? [
        'diff',
        base,
        '--',
        '.',
        ':!pnpm-lock.yaml',
        ':!yarn.lock',
        ':!package-lock.json',
        ':!node_modules',
        ':!.omega',
      ]
    : ['diff', '--', '.', ':!pnpm-lock.yaml', ':!yarn.lock', ':!package-lock.json', ':!node_modules', ':!.omega'];
  return git(projectPath, args);
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
