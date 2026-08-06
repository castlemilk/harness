import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { omegaDatabaseDir } from '@omega/core';
import { PrismaClient } from '../generated/client/index.js';
import { snapshotPgliteDataDir } from './snapshot.js';

const databaseDir = omegaDatabaseDir();

function initPglite(): PGlite {
  return new PGlite(databaseDir);
}

/**
 * Check whether another live process currently owns this PGlite data dir.
 * postgres leaves postmaster.pid behind on any non-graceful exit, so a stale
 * file is NORMAL — but if the pid it records is still alive, another process
 * (e.g. a second server, or a CLI that constructed PGlite) holds the dir.
 * Snapshotting in that case would destroy a live database, so we must not.
 */
function dataDirOwnedByLiveProcess(): boolean {
  const pidPath = `${databaseDir}/postmaster.pid`;
  try {
    const firstLine = fs.readFileSync(pidPath, 'utf-8').split('\n')[0].trim();
    const pid = Number(firstLine);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Failure-driven recovery: try opening the existing data dir as-is (PGlite is
// a real postgres build and recovers stale locks itself). Only if init actually
// FAILS (WASM abort / waitReady rejection) do we snapshot the broken dir aside
// and retry against a fresh empty dir — and even then only when no live process
// owns the dir. Top-level await guarantees this runs to completion before any
// module that imports @omega/db is evaluated, so the synchronous `prisma`
// export below is always a ready client.
let pglite: PGlite;
try {
  pglite = initPglite();
  await pglite.waitReady;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (dataDirOwnedByLiveProcess()) {
    throw new Error(
      `PGlite data dir "${databaseDir}" is in use by another running process; ` +
        `cannot open it here. Refusing to snapshot a live database. Original error: ${msg}`,
    );
  }
  // Only snapshot for PGlite-shaped failures — surfacing the raw error for a
  // permission bug, OOM, or unrelated TypeError is more honest than silently
  // wiping user data.
  const isPgliteLike = /pglite|wasm|emscripten|aborted/i.test(msg);
  if (!isPgliteLike) throw err;
  const snapshotPath = snapshotPgliteDataDir();
  if (snapshotPath) {
    console.error(`[PGlite recovery] Snapshot of corrupted data dir created at: ${snapshotPath}`);
    pglite = initPglite();
    await pglite.waitReady;
  } else {
    throw new Error(
      `PGlite WASM failed to initialize on dir "${databaseDir}" (${msg}) and the ` +
        `corrupted dir could not be moved aside. Run: ` +
        `node packages/db/dist/cli-reset.js --yes to wipe it manually.`,
    );
  }
}
const adapter = new PrismaPGlite(pglite);

export { pglite };
export const prisma = new PrismaClient({ adapter });
