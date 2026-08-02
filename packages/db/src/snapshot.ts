import fs from 'node:fs';
import { omegaDatabaseDir } from '@omega/core';

/**
 * Detect a stale PGlite data dir (postmaster.pid with an mtime older than
 * `maxAgeMs`) and rename it aside to preserve user data before the next init
 * tries to construct a PGlite over potentially-corrupted state.
 *
 * Safe to call at server startup BEFORE `new PGlite(...)`. If no stale lock is
 * present, this is a no-op. Best-effort: if rename fails (open file handles),
 * falls back to copy+remove.
 *
 * After renaming, the helper RECREATES an empty dir at the original path so
 * the next PGlite init has somewhere to write — PGlite's `new PGlite(dir)`
 * will use the existing dir if it exists, but won't create a missing one
 * after a rename.
 *
 * @returns the snapshot path on success, `null` if no snapshot was needed.
 */
export function snapshotStalePgliteDir(maxAgeMs = 5000): string | null {
  const dir = omegaDatabaseDir();
  const pidPath = `${dir}/postmaster.pid`;
  if (!fs.existsSync(pidPath)) return null;
  const mtimeMs = fs.statSync(pidPath).mtimeMs;
  if (Date.now() - mtimeMs < maxAgeMs) return null;
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
  // Recreate the original dir as empty so the next PGlite init can populate it.
  fs.mkdirSync(dir, { recursive: true });
  return target;
}
