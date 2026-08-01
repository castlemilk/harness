import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Return the root directory for all Omega harness storage.
 * Defaults to `~/.omega` unless `OMEGA_STORAGE_ROOT` is set.
 *
 * Callers that write into this tree should ensure subdirectories exist
 * (the helpers below do so automatically).
 */
export function omegaStorageRoot(): string {
  return process.env.OMEGA_STORAGE_ROOT ?? path.join(os.homedir(), '.omega');
}

function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory where benchmark and E2E reports are stored. */
export function omegaReportsDir(): string {
  return ensureDir(path.join(omegaStorageRoot(), 'reports'));
}

/** Directory where self-improve loop iteration reports are stored. */
export function omegaIterationsDir(): string {
  return ensureDir(path.join(omegaStorageRoot(), 'iterations'));
}

/** Directory where job artifacts (e.g. Pier runs) are stored. */
export function omegaJobsDir(): string {
  return ensureDir(path.join(omegaStorageRoot(), 'jobs'));
}

/** Directory where transient working directories are created. */
export function omegaWorkDir(): string {
  return ensureDir(path.join(omegaStorageRoot(), 'work'));
}

/** Directory where verifier tooling is cached (e.g. junit-to-ctrf). */
export function omegaVerifierToolsDir(): string {
  return ensureDir(path.join(omegaStorageRoot(), 'verifier-tools'));
}

/** Directory where the embedded PGlite database lives. */
export function omegaDatabaseDir(): string {
  const dir = process.env.DATABASE_DIR ?? path.join(omegaStorageRoot(), 'pglite-data');
  return ensureDir(dir);
}
