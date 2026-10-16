import path from 'node:path';

/**
 * Environment for a child process whose working directory differs from the
 * harness server's own.
 *
 * `spawn` (and `pty.spawn`) change the child's real working directory but leave
 * `PWD` inherited from the parent, and `PWD` is supposed to name the current
 * working directory. CLIs that resolve their project from `PWD` — OpenCode v2
 * does — then operate on whatever directory the server was started in instead of
 * the task checkout. Setting it here keeps the two consistent for every
 * externally spawned CLI.
 *
 * @param cwd the working directory passed to the spawn call
 * @param overrides extra environment entries for this CLI
 */
export function childProcessEnv(cwd: string, overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // PWD is applied last: it must describe the child's real working directory,
  // never a stale value inherited from the parent or supplied by a caller.
  return { ...process.env, ...overrides, PWD: path.resolve(cwd) };
}
