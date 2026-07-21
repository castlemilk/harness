import type { IPty } from 'node-pty';
import stripAnsi from 'strip-ansi';

export interface PtyResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SpawnPtyOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/**
 * Spawn a command in a PTY and capture its output.
 *
 * Required for CLIs that gate stdout on isatty() (e.g. agy/antigravity-cli).
 * PTY merges stderr into stdout — this is acceptable because the caller
 * (runExternalAgentTask) already concatenates stdout and stderr into a
 * single output string.
 */
export async function spawnWithPty(
  command: string,
  args: string[],
  options: SpawnPtyOptions,
): Promise<PtyResult> {
  // Dynamic import so non-PTY code paths don't require node-pty at all.
  const pty = await import('node-pty');

  const env = { ...process.env, ...options.env };
  const rows = 24;
  const cols = 120;

  let ptyProcess: IPty;
  try {
    ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd,
      env,
    });
  } catch {
    // Binary not found or other spawn error
    throw new Error(`Failed to spawn '${command}' in PTY — binary may not be installed`);
  }

  const outputChunks: string[] = [];
  let settled = false;

  const onData = ptyProcess.onData((data: string) => {
    if (!settled) outputChunks.push(data);
  });

  const exitPromise = new Promise<number>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      resolve(exitCode);
    });
  });

  // Timeout: SIGTERM → 5s grace → SIGKILL
  const timeoutId = setTimeout(() => {
    if (settled) return;
    const pid = ptyProcess.pid;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Process may already be dead
    }
    setTimeout(() => {
      if (settled) return;
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Ignore
      }
    }, 5_000);
  }, options.timeoutMs);

  let exitCode: number;
  try {
    exitCode = await exitPromise;
  } finally {
    settled = true;
    clearTimeout(timeoutId);
    onData.dispose();
    // Always close the PTY fd to prevent leaked pseudo-terminals
    try {
      ptyProcess.kill();
    } catch {
      // Already dead
    }
  }

  const raw = outputChunks.join('');
  // Strip ANSI escape sequences (cursor movement, colors, clear-screen)
  const stdout = stripAnsi(raw);

  return { stdout, stderr: '', exitCode };
}
