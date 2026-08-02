# PGlite WASM Robustness — Design

**Date:** 2026-08-02
**Status:** Draft (pre-implementation) — REVISED after 2 spec reviews
**Owner:** Omega harness

> **Revision history:**
> - v1 (commit `4ce3ed6`): sync try/catch around `new PGlite(dir)` was the central mechanism.
> - v2 (commit `2614e3d`): pre-init snapshot at server startup was the central mechanism.
> - **v3 (this version):** v2 was dead code under V8 ESM (static imports are hoisted, so the snapshot ran AFTER the `@omega/db` import resolved). The fix: use a **dynamic `await import('...')`** for the `@omega/db` import so the snapshot can run before PGlite loads. The `cli-reset.ts` standalone script is unchanged but now also requires a `--yes` flag for safety. The error message in `client.ts` was updated to drop the obsolete `OMEGA_DB_RESET=1` env-var reference.

## Problem

When the harness server restarts after an abrupt kill (process crash, OOM, host reboot), PGlite occasionally aborts during `new PGlite(databaseDir)` initialization at `packages/db/src/client.ts:8`. The WebAssembly runtime reports `RuntimeError: Aborted()` with no JavaScript stack — only the WASM frame chain. The server then process-exits before binding any port.

This session has hit this 4+ times (each fix took >30s of empirical `rm -f ~/.omega/pglite-data/postmaster.pid` + the WASM still failed). Four historical `pglite-data-backup-*` directories under `/Volumes/gamma-systems-2/omega/` confirm this is a recurring class of failure, not a one-off.

The current state:
- `client.ts:6-9` constructs PGlite eagerly at module load.
- If WASM aborts (sync OR async), the import throws or the process dies. No recovery code. No diagnostic. The operator has no in-band path to clear the corrupted state.
- `applyMigrations` (called by `apps/server/src/index.ts:33`) would have run successfully if PGlite had initialized — but it never gets a chance.

## Goal

1. Make the corruption **detectable** (we can spot a stale `postmaster.pid`) without fully re-implementing PGlite's async init.
2. Make the data **recoverable** via a standalone CLI script with a safety flag — a fresh `node cli-reset.js --yes` wipes the data dir, the next server boot re-bootstraps.
3. Preserve the package's API surface — no downstream consumer changes required (the dynamic-import refactor in `apps/server/src/index.ts` is the only behavior change visible to consumers; existing static `import { prisma } from '@omega/db'` continues to work via the project's compiled output).

## Non-goals

- Fully async PGlite init. We work around the WASM-abort path with a pre-init snapshot + dynamic import.
- Root-cause investigation of why PGlite WASM aborts on certain warm starts.
- Smoke-test automation.

## Design

### 1. Pre-init snapshot routine

`packages/db/src/snapshot.ts` (new file, ~40 LOC):

```ts
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
    return target;
  } catch {
    // rename can fail if PGlite left open handles; fall back to copy+remove.
    try {
      fs.cpSync(dir, target, { recursive: true, errorOnExist: false });
      fs.rmSync(dir, { recursive: true, force: true });
      return target;
    } catch {
      return null;
    }
  }
}
```

`packages/db/src/snapshot.ts` depends ONLY on `node:fs` + `@omega/core`. No PGlite, no `@omega/db` circular. This is the key requirement: it must load without triggering PGlite.

### 2. `client.ts` defensive sync try/catch + `waitReady.catch`

`packages/db/src/client.ts` (currently 11 LOC):

```ts
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
  // also attach a no-op catch so the rejection doesn't trigger
  // unhandledRejection. Log the reason.
  pglite.waitReady.catch((err) => {
    console.error(`[PGlite] waitReady rejected: ${err instanceof Error ? err.message : String(err)}`);
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const isAbort = msg.includes('Aborted') || msg.includes('RuntimeError');
  if (!isAbort) throw err;
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
```

The async-abort path is now best-effort: `waitReady.catch` logs the reason (so the operator sees it) but doesn't re-throw. The recovery is via the pre-init snapshot, NOT this catch.

### 3. Standalone reset CLI with `--yes` safety flag

`packages/db/src/cli-reset.ts` (new file, ~20 LOC):

```ts
#!/usr/bin/env node
import fs from 'node:fs';
import { omegaDatabaseDir } from '@omega/core';

const dir = omegaDatabaseDir();
const confirmed = process.argv.includes('--yes');

if (!confirmed) {
  console.error(`[PGlite reset] This will wipe the data dir at:`);
  console.error(`  ${dir}`);
  console.error(`[PGlite reset] Re-run with --yes to confirm.`);
  process.exit(1);
}

if (fs.existsSync(dir)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${dir}.manual-reset-${stamp}`;
  fs.renameSync(dir, backup);
  console.error(`[PGlite reset] Moved ${dir} → ${backup}`);
}
fs.mkdirSync(dir, { recursive: true });
console.error(`[PGlite reset] Created fresh empty dir at ${dir}.`);
console.error(`[PGlite reset] Restart the server to run migrations + seed.`);
```

Built as `node packages/db/dist/cli-reset.js`. The `--yes` flag prevents accidental wipes.

### 4. Server-startup snapshot via **dynamic import**

`apps/server/src/index.ts` — restructure imports so the snapshot runs before PGlite's WASM init:

```ts
// Static imports — must all be at the top of the module. None of these depend
// on @omega/db (and therefore none trigger PGlite construction).
import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { snapshotStalePgliteDir } from '@omega/db/snapshot';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 4000);
const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051);
const HOST = process.env.HOST ?? '127.0.0.1';
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? path.resolve(__dirname, '../web');
process.env.SKILLS_DIR = process.env.SKILLS_DIR ?? path.resolve(__dirname, '../skills');

dotenvConfig();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Snapshot any stale PGlite data dir BEFORE loading @omega/db.
// This function depends only on @omega/core (no PGlite), so it's safe
// to call here. Without this snapshot, the @omega/db dynamic import below
// would construct PGlite on a corrupted dir and abort.
const snapshotTarget = snapshotStalePgliteDir();
if (snapshotTarget) {
  console.log(`[PGlite recovery] Snapshot of stale data dir created at: ${snapshotTarget}`);
}

// DYNAMIC import — runs after the snapshot. Static imports would have been
// hoisted by V8's ESM loader, defeating the purpose of the snapshot.
const dbModule = await import('@omega/db');
const { prisma, applyMigrations, seedDefaults } = dbModule;
const { app } = await import('./app.js');
const { seedSkills } = await import('./seed-skills.js');
const { startGrpcServer } = await import('./grpc.js');
const { queue } = await import('./lib/task-queue.js');
const { getRouter, shutdownRouter } = await import('./lib/intelligent-router.js');
const { checkThresholds } = await import('./lib/webhook-alerts.js');

// ... rest of the file uses the destructured `prisma`, `applyMigrations`, etc. unchanged.
```

**Why dynamic import:** in V8 ESM, ALL static `import` statements are hoisted to the top of the module before any user code runs. The `import { prisma } from '@omega/db'` line would trigger PGlite construction BEFORE the body executes. A dynamic `await import('...')` is evaluated when called, not hoisted, so we can run the snapshot first. This is the only way to guarantee ordering under V8 ESM.

### 5. Exports

`packages/db/src/index.ts` re-exports the new helper:

```ts
export * from './client.js';
export * from './migrate.js';
export * from './seed.js';
export * from '../generated/client/index.js';
```

(`snapshot.ts` and `cli-reset.ts` are NOT re-exported from `index.ts` — they're loaded as subpath imports `@omega/db/snapshot` and `@omega/db/cli-reset` respectively.)

### 6. Subpath exports in `packages/db/package.json`

Add the new subpath exports:

```jsonc
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./snapshot": {
    "import": "./dist/snapshot.js",
    "types": "./dist/snapshot.d.ts"
  },
  "./cli-reset": {
    "import": "./dist/cli-reset.js"
  }
}
```

Without this, `import { snapshotStalePgliteDir } from '@omega/db/snapshot'` will fail at runtime (Node will look for a `./snapshot` subpath that doesn't exist).

### 7. `.env.example` documentation

```sh
# PGlite WASM recovery:
# When the data dir is corrupted (WASM abort on init), the server's startup
# routine snapshots the dir to .corrupt-{timestamp}. To recover:
#   1. Restart the server — pre-init snapshot will move the bad dir aside
#      and the next PGlite init will run against an empty (recreated) dir.
#   2. OR: build the package and run the standalone reset CLI:
#        pnpm --filter @omega/db build && node packages/db/dist/cli-reset.js --yes
#      This wipes the data dir (requires --yes to prevent accidents).
```

## Data flow

```
1. Server starts: `node apps/server/dist/index.js`
2. Static imports at the top evaluate (no @omega/db yet):
   - `dotenv`, `express`, etc.
   - `@omega/db/snapshot` (loads snapshot.ts — no PGlite).
3. Function body starts running.
4. `dotenvConfig()` loads .env.
5. `snapshotStalePgliteDir()` checks for a stale `postmaster.pid` (mtime > 5s old).
   If stale: rename data dir to `.corrupt-{timestamp}`.
6. The first `await import('@omega/db')` runs.
   - This evaluates `client.ts`, which does `new PGlite(databaseDir)`.
   - If WASM aborts at this point: pre-init snapshot already moved the bad dir aside.
7. `applyMigrations()` + `seedDefaults()` + `seedSkills()` run against the fresh dir.
8. Server binds port, ready to serve.

Recovery (alternative, manual):
- Operator runs `node packages/db/dist/cli-reset.js --yes` → wipes the dir manually.
- Restart the server → starts against a fresh empty dir → migrations + seed → ready.
```

## Risks

- **Snapshot timing race**: if the server's startup snapshot runs WHILE another harness process holds the dir open (highly unlikely — PGlite is single-writer), `renameSync` can fail. The fallback (`fs.cpSync` + `rmSync`) catches this.
- **Auto-recovery vs manual recovery**: this design deliberately does NOT auto-rehydrate. The next server boot after a snapshot runs migrations + seed against an empty dir — that IS the rehydrate. So users always see a clean DB after a crash, no manual step needed for the common case (just an empty workspace).
- **`postmaster.pid` is 55 bytes** (per inspection) but PGlite uses it as an advisory lock. Real lock state is in WASM memory — the file is a hint, not enforcement. We rely on mtime as a "this lock is stale" signal.
- **Dynamic import refactor in `apps/server/src/index.ts`**: the destructured names (`prisma`, `applyMigrations`, etc.) must be used AFTER the dynamic import resolves. Existing code references these names after the imports — that part is unchanged. The new wrinkle: the file is now a top-level await module. This requires `package.json` to declare `"type": "module"` (it does) and `tsconfig.json` to compile to ESM (it does — `"module": "NodeNext"`). No consumer changes.
- **`@omega/db/snapshot` and `@omega/db/cli-reset` subpaths must be exported** in `packages/db/package.json#exports`. Forgetting the subpath export is the #1 likely build failure; the spec §6 calls this out.

## Files touched

| File | Change | LOC |
|---|---|---|
| `packages/db/src/snapshot.ts` (new) | `snapshotStalePgliteDir` helper | +40 |
| `packages/db/src/client.ts` | Sync try/catch + `waitReady.catch` for async | +18 |
| `packages/db/src/cli-reset.ts` (new) | Standalone reset CLI with `--yes` safety | +20 |
| `packages/db/package.json` | Add `./snapshot` and `./cli-reset` subpath exports | +12 |
| `apps/server/src/index.ts` | Restructure to static + dynamic imports + snapshot call | +5 (modifications) |
| `.env.example` | Document recovery procedure | +6 |

Total: 5 source files + 1 config + 1 doc, ~100 LOC.

## Acceptance criteria

1. With a fresh `~/.omega/pglite-data/` (or equivalent), the server boots normally; behavior unchanged from today.
2. With a hand-corrupted `postmaster.pid` (mtime > 5s old), the server's startup sequence snaps the dir to `.corrupt-{timestamp}` BEFORE `new PGlite()` is called. Subsequent PGlite init runs against an empty dir; server boots cleanly with empty tasks.
3. After a snapshot, the next PGlite init either:
   - **Succeeds** (most likely — the WASM abort was caused by the corrupted state, which is now gone) → server serves with empty workspace.
   - **Still aborts** (the WASM abort is unrelated to corruption — true upstream bug) → process exits with uncaughtException; the snapshot is preserved; operator uses the standalone CLI.
4. `node packages/db/dist/cli-reset.js` (without `--yes`) prints the data dir path and a "Re-run with --yes to confirm" message, then exits non-zero — confirming the safety flag works.
5. `node packages/db/dist/cli-reset.js --yes` wipes the dir and prints the backup path.
6. The `@omega/db` package's existing exported API (`prisma`, `pglite`, `applyMigrations`, `seed`, etc.) is unchanged. Consumers (server, CLI, agent) that import `@omega/db` continue to work without changes — the dynamic-import refactor is contained in `apps/server/src/index.ts`.
7. No regression: existing `@omega/agent` + CLI tests continue to pass.
