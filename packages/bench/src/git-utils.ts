import { execFileSync } from 'node:child_process';

/**
 * Ensure a directory is a git repository, initializing one if needed.
 */
export function ensureGitRepo(repoPath: string): void {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'ignore', env: process.env });
    return;
  } catch {
    // not a git repo; initialise one.
  }
  execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['config', 'user.email', 'bench@omega.local'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['config', 'user.name', 'Omega Bench'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['commit', '-m', 'bench init'], { cwd: repoPath, stdio: 'ignore', env: process.env });
}

/**
 * Reset a git repo to a specific commit, discarding all changes.
 */
export function resetToCommit(repoPath: string, commit: string): void {
  execFileSync('git', ['reset', '--hard', commit], { cwd: repoPath, stdio: 'ignore', env: process.env });
  execFileSync('git', ['clean', '-fd'], { cwd: repoPath, stdio: 'ignore', env: process.env });
}
