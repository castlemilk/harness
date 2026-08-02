#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { omegaDatabaseDir } from '@omega/core';

const dir = omegaDatabaseDir();
const confirmed = process.argv.includes('--yes');

if (!confirmed) {
  console.error(`[PGlite reset] This will wipe the data dir at:`);
  console.error(`  ${dir}`);
  console.error(`[PGlite reset] Re-run with --yes to confirm.`);
  process.exit(1);
}

// Only rename if PGlite has actually initialized the dir (signaled by the
// postmaster.pid file). If the dir is empty (just `ensureDir`'d), there's
// nothing to preserve.
const hasPostmaster = fs.existsSync(path.join(dir, 'postmaster.pid'));

if (hasPostmaster) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${dir}.manual-reset-${stamp}`;
  try {
    fs.renameSync(dir, backup);
    console.error(`[PGlite reset] Moved ${dir} → ${backup}`);
  } catch {
    // rename can fail (open file handles, cross-device link, etc.); fall back to copy+remove.
    try {
      fs.cpSync(dir, backup, { recursive: true, errorOnExist: false });
      fs.rmSync(dir, { recursive: true, force: true });
      console.error(`[PGlite reset] Moved ${dir} → ${backup} (via copy+remove fallback)`);
    } catch (err) {
      console.error(`[PGlite reset] Failed to move ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[PGlite reset] Stop any running server holding ${dir} open, then retry.`);
      process.exit(1);
    }
  }
}
fs.mkdirSync(dir, { recursive: true });
console.error(`[PGlite reset] Created fresh empty dir at ${dir}.`);
console.error(`[PGlite reset] Restart the server to run migrations + seed.`);
