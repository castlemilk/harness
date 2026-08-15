import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

/**
 * Repo-relative helpers shared by the local dev commands.
 *
 * The important one is `repoRoot`: every package's scripts set
 * `DATABASE_DIR=./pglite-data`, which resolves against the *package* directory.
 * Run the server and you get `apps/server/pglite-data`; run the migration and
 * you get `packages/db/pglite-data` — two different databases, so migrating
 * never reaches the database the server reads. Anchoring to the repo root gives
 * every command one database.
 */
export function repoRoot(from = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

/** The one database every local command should agree on. */
export function defaultDatabaseDir(root = repoRoot()): string {
  return process.env.DATABASE_DIR ?? path.join(root, 'pglite-data');
}

export function defaultDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgresql://localhost:5432/omega';
}

/** Resolve true when something is already listening on the port. */
export function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (inUse: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(600);
    socket.once('connect', () => { done(true); });
    socket.once('timeout', () => { done(false); });
    socket.once('error', () => { done(false); });
  });
}

/** First free port at or after `from`, so a stale server never silently wins. */
export async function firstFreePort(from: number, attempts = 20): Promise<number> {
  for (let port = from; port < from + attempts; port++) {
    if (!(await portInUse(port))) return port;
  }
  throw new Error(`No free port between ${String(from)} and ${String(from + attempts)}`);
}

export async function waitForHttp(url: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Every pglite data dir in the repo — more than one means divergence. */
export function findDataDirs(root = repoRoot()): string[] {
  const candidates = [
    path.join(root, 'pglite-data'),
    path.join(root, 'apps', 'server', 'pglite-data'),
    path.join(root, 'packages', 'db', 'pglite-data'),
  ];
  return candidates.filter((dir) => fs.existsSync(dir));
}

export function dirSizeMb(dir: string): number {
  // A PGlite data dir holds thousands of small files; walking it in JS took
  // tens of seconds. `du` answers instantly.
  try {
    const out = execFileSync('du', ['-sk', dir], { encoding: 'utf-8' });
    const kb = Number(out.trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? Math.round((kb / 1024) * 10) / 10 : 0;
  } catch {
    return 0;
  }
}
