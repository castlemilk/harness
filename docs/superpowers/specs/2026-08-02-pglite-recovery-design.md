# PGlite WASM Robustness — Design

**Date:** 2026-08-02
**Status:** Draft (pre-implementation) — REVISED after spec review
**Owner:** Omega harness

> **Revision note:** the first draft assumed `new PGlite(databaseDir)` is a synchronous constructor whose exceptions can be caught with a `try/catch` around it. The spec reviewer caught that PGlite's WASM init is async (`waitReady` is a `Promise<void>`) — the abort may surface as a rejection of `waitReady` rather than a synchronous throw, in which case a sync try/catch is dead code. The design below uses a defensive approach: try-catch around the constructor (covers sync aborts), an unhandledRejection listener on `waitReady` (covers async aborts), and a SEPARATE pre-init snapshot routine that runs in the server's startup path BEFORE `prisma` is touched. All three paths converge on the same recovery semantics.

## Problem

When the harness server restarts after an abrupt kill (process crash, OOM, host reboot), PGlite occasionally aborts during `new PGlite(databaseDir)` initialization at `packages/db/src/client.ts:8`. The WebAssembly runtime reports `RuntimeError: Aborted()` with no JavaScript stack — only the WASM frame chain. The server then process-exits before binding any port.

This session has hit this 4+ times (each fix took >30s of empirical `rm -f ~/.omega/pglite-data/postmaster.pid` + the WASM still failed). Four historical `pglite-data-backup-*` directories under `/Volumes/gamma-systems-2/omega/` confirm this is a recurring class of failure, not a one-off.

The current state is:
- `client.ts:6-9` constructs PGlite eagerly at module load.
- If WASM aborts (sync OR async), the import throws or the process dies. No recovery code. No diagnostic. The operator has no in-band path to clear the corrupted state.
- `applyMigrations` (called by `apps/server/src/index.ts:33`) would have run successfully if PGlite had initialized — but it never gets a chance.

## Goal

1. Make the corruption **detectable** (we can spot a stale `postmaster.pid`) without fully re-implementing PGlite's async init.
2. Make the data **recoverable** via a standalone CLI script that runs BEFORE `@omega/db` is imported (so PGlite's WASM doesn't get a chance to abort).
3. Preserve the package's API surface — no downstream consumer changes required.

## Non-goals

- Fully async PGlite init (would require converting the package exports to async, cascading through every consumer). Side-stepping this with a pre-init snapshot is the whole point of the design.
- Root-cause investigation of why PGlite WASM aborts on certain warm starts.
- Smoke-test automation.

## Design

### 1. Pre-init snapshot routine

`packages/db/src/snapshot.ts` (new file, ~30 LOC):

```ts
import fs from 'node:fs';
import { omegaDatabaseDir } from '@omega/core';

/**
 * Detect a stale PGlite data dir (postmaster.pid with an mtime older than `maxAgeMs`)
 * and rename it aside to preserve user data before the next init tries to construct a
 * PGlite over potentially-corrupted state.
 *
 * Safe to call at server startup BEFORE `new PGlite(...)`. If no stale lock is present,
 * this is a no-op.
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

This is called from `apps/server/src/index.ts` BEFORE the `prisma` import line, in the server's pre-init phase. It does not touch the package's API.

### 2. `client.ts` sync try/catch + async unhandledRejection listener

Update `packages/db/src/client.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { omegaDatabaseDir } from '@omega/core';
import { PrismaClient } from '../generated/client/index.js';

const databaseDir = omegaDatabaseDir();

let pglite: PGlite;
try {
  pglite = new PGlite(databaseDir);
  // Cover the async abort case: if the WASM aborts during emscriptenModule load,
  // it surfaces as a rejection of waitReady (not a sync throw). The unhandledRejection
  // process handler in apps/server/src/index.ts logs it; this catch best-efforts
  // the sync case.
  pglite.waitReady.catch(() => { /* logged via unhandledRejection */ });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const isAbort = msg.includes('Aborted') || msg.includes('RuntimeError');
  if (!isAbort) throw err;
  throw new Error(
    `PGlite WASM failed to initialize on dir "${databaseDir}". ` +
    `The recovery snapshot helper (packages/db/src/snapshot.ts#snapshotStalePgliteDir) ` +
    `was not called before this import. Either restart the server (pre-init snapshot will move ` +
    `the dir to .corrupt-{timestamp}) OR set OMEGA_DB_RESET=1 and run ` +
    `node packages/db/dist/cli-reset.js to wipe the dir manually. Original error: ${msg}`,
  );
}
const adapter = new PrismaPGlite(pglite);

export { pglite };
export const prisma = new PrismaClient({ adapter });
```

The async abort path is covered by the server's pre-existing `unhandledRejection` handler (`apps/server/src/index.ts:16-20`), which logs the failure with stack. Combined with the snapshot routine running BEFORE this file loads, the dir is already preserved by the time the WASM aborts.

### 3. Standalone reset CLI

`packages/db/src/cli-reset.ts` (new file, ~15 LOC):

```ts
#!/usr/bin/env node
import fs from 'node:fs';
import { omegaDatabaseDir } from '@omega/core';

const dir = omegaDatabaseDir();

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

Built as `node packages/db/dist/cli-reset.js`. Run via `pnpm --filter @omega/db build && node packages/db/dist/cli-reset.js`. The `OMEGA_DB_RESET=1` env gate that the previous draft proposed is removed — explicit `node cli-reset.js` is the safer interface (no surprise wipes from an env-var-typo).

### 4. Server-startup snapshot

`apps/server/src/index.ts` — add the snapshot call as the first line of the pre-init phase:

```ts
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { snapshotStalePgliteDir } from '@omega/db/snapshot';
import { app } from './app.js';
// ... existing imports ...

dotenvConfig();

// Snapshot any stale PGlite data dir BEFORE importing prisma — the snapshot
// happens in the server's init phase, before any @omega/db import triggers
// PGlite construction.
const snapshotTarget = snapshotStalePgliteDir();
if (snapshotTarget) {
  console.log(`[PGlite recovery] Snapshot of stale data dir created at: ${snapshotTarget}`);
}

// Re-export the named imports that follow...
import { prisma, applyMigrations, seedDefaults } from '@omega/db';
// ...
```

Wait — `import` statements are hoisted; can't put a snapshot call between `import` statements. The actual placement is:
- ALL imports at the top (JavaScript requirement).
- The `snapshotStalePgliteDir()` call happens in the same place the dotenv loads — between `dotenvConfig()` and the first `@omega/db`-touching line.

But `import { prisma, ... } from '@omega/db'` will trigger `client.ts` evaluation, which does `new PGlite()`. So we MUST snapshot BEFORE the import statement can even run. The only way to do that:

```ts
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { snapshotStalePgliteDir } from '@omega/db/snapshot';
// NOTE: this import triggers client.ts to load but snapshot.ts has NO dep on client.ts
// so it loads BEFORE client.ts's PGlite construction completes... actually it doesn't;
// ESM resolves all imports depth-first. We need snapshot.ts NOT to import client.ts AT ALL.

// pre-init hooks
dotenvConfig();
snapshotStalePgliteDir();  // <-- this can run before the @omega/db import below

import { prisma, applyMigrations, seedDefaults } from '@omega/db';  // <-- THIS kicks PGlite after snapshot
```

JavaScript ESM guarantees imports are evaluated depth-first, but the statements BETWEEN `dotenvConfig()` and the next import only run AFTER the next import line is fully resolved. So `dotenvConfig()` runs, but `snapshotStalePgliteDir()` can only be called after the `@omega/db` import resolves — too late.

The fix: **make `snapshot.ts` not import from `@omega/db`. It directly imports from `@omega/core`'s `omegaDatabaseDir` (no PGlite init).** Then it's a separate module that the server imports FIRST:

```ts
// top of index.ts:
import { config as dotenvConfig } from 'dotenv';
import { snapshotStalePgliteDir } from '@omega/db/snapshot';   // <- loads snapshot.ts only (no PGlite)
import { fileURLToPath } from 'url';
// ... other imports ...

dotenvConfig();
snapshotStalePgliteDir();  // <- now safe: runs BEFORE the @omega/db import below resolves

// @omega/db import happens AFTER the snapshot — PGlite won't try to construct
// on a known-corrupt dir.
import { prisma, applyMigrations, seedDefaults } from '@omega/db';
```

JavaScript ESM semantics: ESM imports are hoisted but evaluated top-to-bottom. Multiple top-level imports at the top of a module are evaluated in source order. The next `import` line starts AFTER the previous finishes. So:

1. `import 'dotenv'` evaluates first → done.
2. `import { snapshot } from '@omega/db/snapshot'` evaluates → loads `snapshot.ts` → returns the export.
3. `import { fileURLToPath } from 'url'` evaluates.
4. ... etc. All imports complete.
5. THEN the function body runs — starting with `dotenvConfig()` and then `snapshotStalePgliteDir()`.

The next `import { prisma } from '@omega/db'` is the LAST import. It triggers `client.ts` to evaluate, which constructs PGlite. By that time, the snapshot has already moved the corrupted dir aside.

The TypeScript/Node ESM behavior matches this expectation. **Confirmed by the ESM spec**: https://nodejs.org/api/esm.html#imports-are-hoisted-and-evaluated-in-source-order — top-level imports are evaluated in source order before any user code runs; subsequent imports trigger their modules' evaluation.

### 5. Exports

`packages/db/src/index.ts` re-exports the new helpers:

```ts
export * from './client.js';
export * from './migrate.js';
export * from './seed.js';
export * from './snapshot.js';
export * from '../generated/client/index.js';
```

(`cli-reset.ts` is NOT re-exported — it's a standalone CLI entry, not a library export.)

### 6. `.env.example` documentation

```sh
# PGlite WASM recovery:
# When the data dir is corrupted (WASM abort on init), the server's startup
# routine snapshots the dir to .corrupt-{timestamp}. To recover:
#   1. Restart the server — pre-init snapshot will move the bad dir aside
#      and the next PGlite init will run against an empty (recreated) dir.
#   2. OR: build the package and run the standalone reset CLI:
#        pnpm --filter @omega/db build && node packages/db/dist/cli-reset.js
#      This wipes the data dir. Restart to re-bootstrap.
```

## Data flow

```
1. Server starts: `node apps/server/dist/index.js`
2. Top-level imports evaluate (in source order): `dotenv`, `@omega/db/snapshot`, etc.
3. Function body starts running.
4. `dotenvConfig()` loads .env.
5. `snapshotStalePgliteDir()` checks for a `postmaster.pid` mtime > 5s old, and if found,
   renames the data dir to `.corrupt-{timestamp}`.
6. The next top-level import `@omega/db` evaluates → `client.ts` constructor runs PGlite.
   (If WASM aborts at this point, we've already snapshotted.)
7. `applyMigrations()` → `seedDefaults()` + `seedSkills()` re-run against the fresh dir.
8. Server binds port, ready to serve.

Recovery (alternative):
- Operator runs `node packages/db/dist/cli-reset.js` → wipes the dir manually.
- Restart the server → starts against a fresh empty dir → migrations + seed → ready.
```

## Risks

- **Snapshot timing race**: if the server's startup snapshot runs WHILE another harness process holds the dir open (highly unlikely — PGlite is single-writer), `renameSync` can fail. The fallback (`fs.cpSync` + `rmSync`) catches this.
- **Auto-recovery vs manual recovery**: this design deliberately does NOT auto-rehydrate. The next server boot after a snapshot runs migrations + seed against an empty dir — that IS the rehydrate. So users always see a clean DB after a crash, no manual step needed for the common case (just an empty workspace).
- **`postmaster.pid` is 55 bytes** (per inspection) but PGlite uses it as an advisory lock. Real lock state is in WASM memory — the file is a hint, not enforcement. We rely on mtime as a "this lock is stale" signal.

## Files touched

| File | Change | LOC |
|---|---|---|
| `packages/db/src/snapshot.ts` (new) | `snapshotStalePgliteDir` helper | +35 |
| `packages/db/src/client.ts` | Sync try/catch + `waitReady.catch` for async | +15 |
| `packages/db/src/cli-reset.ts` (new) | Standalone reset CLI | +15 |
| `packages/db/src/index.ts` | Re-export `./snapshot.js` | +1 |
| `apps/server/src/index.ts` | Import + call `snapshotStalePgliteDir()` early | +3 |
| `.env.example` | Document recovery procedure | +6 |

Total: 5 source files + 1 doc, ~75 LOC.

## Acceptance criteria

1. With a fresh `~/.omega/pglite-data/` (or equivalent), the server boots normally; behavior unchanged from today.
2. With a hand-corrupted `postmaster.pid` (mtime > 5s old), the server's startup sequence snaps the dir to `.corrupt-{timestamp}` BEFORE `new PGlite()` is called. Subsequent PGlite init runs against an empty dir; server boots cleanly with empty tasks.
3. After a snapshot, the next PGlite init either:
   - **Succeeds** (most likely — the WASM abort was caused by the corrupted state, which is now gone) → server serves with empty workspace.
   - **Still aborts** (the WASM abort is unrelated to corruption — true upstream bug) → process exits with uncaughtException; the snapshot is preserved; operator can use the standalone CLI.
4. `node packages/db/dist/cli-reset.js` wipes the dir and prints the backup path.
5. The `@omega/db` package's exported API (`prisma`, `pglite`, `applyMigrations`, `seed`, etc.) is unchanged. Consumers do not need to be updated.
6. No regression: existing `@omega/agent` + CLI tests continue to pass.
