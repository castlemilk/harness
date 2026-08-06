import fs from 'node:fs';
import { omegaDatabaseDir } from '@omega/core';

/**
 * Move the PGlite data dir aside and recreate an empty dir in its place.
 *
 * Intended to be called ONLY after `new PGlite(dir)` actually fails to
 * initialize (WASM abort / waitReady rejection) — this is failure-driven
 * recovery, NOT a stale-lock heuristic. postmaster.pid is left behind by
 * PGlite whenever its process dies without a graceful postgres shutdown, so
 * its mere existence (even stale) is NOT evidence of corruption; snapshotting
 * on it wiped the whole DB on every server restart.
 *
 * @returns the snapshot path on success, `null` if the move failed.
 */
export function snapshotPgliteDataDir(): string | null {
  const dir = omegaDatabaseDir();
  if (!fs.existsSync(dir)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${dir}.corrupt-${stamp}`;
  try {
    fs.renameSync(dir, target);
  } catch {
    // rename can fail if PGlite left open handles; fall back to copy+remove.
    try {
      fs.cpSync(dir, target, { recursive: true, errorOnExist: false });
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      return null;
    }
  }
  // Recreate the original dir as empty so the next PGlite init has somewhere
  // to write — PGlite's `new PGlite(dir)` will use the existing dir if it
  // exists, but won't create a missing one after a rename.
  fs.mkdirSync(dir, { recursive: true });
  return target;
}
