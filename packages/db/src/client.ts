import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { omegaDatabaseDir } from '@omega/core';
import { PrismaClient } from '../generated/client/index.js';

const databaseDir = omegaDatabaseDir();

let pglite: PGlite;
try {
  pglite = new PGlite(databaseDir);
  // Cover the async-abort case: the WASM may abort during emscriptenModule
  // load and surface as a rejection of waitReady (not a sync throw). The
  // server's pre-init snapshot already moved the corrupted dir aside; we
  // also attach a catch that logs the reason.
  pglite.waitReady.catch((err) => {
    console.error(`[PGlite] waitReady rejected for ${databaseDir}: ${err instanceof Error ? err.message : String(err)}`);
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  // Only wrap PGlite-shaped errors with the friendly recovery hint. Surfacing
  // the original raw error for a permission bug, OOM, or unrelated TypeError
  // would be misleading (the user can't "reset" their way out of those).
  const isPgliteLike = /pglite|wasm|emscripten|aborted/i.test(msg);
  if (!isPgliteLike) throw err;
  throw new Error(
    `PGlite WASM failed to initialize on dir "${databaseDir}". ` +
    `The server's pre-init snapshot (packages/db/src/snapshot.ts) ` +
    `should have moved a corrupted dir aside. If this error persists after a ` +
    `restart, run: node packages/db/dist/cli-reset.js --yes to wipe the data dir. ` +
    `Original error: ${msg}`,
  );
}
const adapter = new PrismaPGlite(pglite);

export { pglite };
export const prisma = new PrismaClient({ adapter });
