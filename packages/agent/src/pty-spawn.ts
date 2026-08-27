import type { IPty } from 'node-pty';
import stripAnsi from 'strip-ansi';

export interface PtyResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
}

interface SpawnPtyOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
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
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new DOMException('PTY process cancelled', 'AbortError');
  }

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
  let timedOut = false;
  let aborted = false;
  let terminationRequested = false;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const onData = ptyProcess.onData((data: string) => {
    if (!settled) outputChunks.push(data);
  });

  const exitPromise = new Promise<number>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      resolve(exitCode);
    });
  });

  const terminate = (reason: 'timeout' | 'abort'): void => {
    if (settled || terminationRequested) return;
    terminationRequested = true;
    timedOut = reason === 'timeout';
    aborted = reason === 'abort';
    const pid = ptyProcess.pid;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        ptyProcess.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }
    forceKillTimer = setTimeout(() => {
      if (settled) return;
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          ptyProcess.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
    }, reason === 'abort' ? 1_000 : 5_000);
  };

  // Timeout: SIGTERM → 5s grace → SIGKILL
  const timeoutId = setTimeout(() => {
    terminate('timeout');
  }, options.timeoutMs);
  const onAbort = (): void => {
    terminate('abort');
  };
  if (options.signal?.aborted) {
    onAbort();
  } else {
    options.signal?.addEventListener('abort', onAbort, { once: true });
  }

  let exitCode: number;
  try {
    exitCode = await exitPromise;
  } finally {
    settled = true;
    clearTimeout(timeoutId);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    options.signal?.removeEventListener('abort', onAbort);
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

  return { stdout, stderr: '', exitCode, timedOut, aborted };
}
