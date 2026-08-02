# PGlite WASM Robustness — Design

**Date:** 2026-08-02
**Status:** Draft (pre-implementation)
**Owner:** Omega harness

## Problem

When the harness server restarts after an abrupt kill (process crash, OOM, host reboot), PGlite occasionally aborts during `new PGlite(databaseDir)` initialization at `packages/db/src/client.ts:8`. The WebAssembly runtime reports `RuntimeError: Aborted()` with no JavaScript stack — only the WASM frame chain. The server then process-exits before binding any port.

In this session alone we've hit this 4+ times (each fix took >30s of session time + an empirical `rm -f ~/.omega/pglite-data/postmaster.pid` dance + the WASM still failed). Four historical `pglite-data-backup-*` directories under `/Volumes/gamma-systems-2/omega/` confirm this is a recurring class of failure, not a one-off.

The current state is:
- `client.ts:6-9` constructs PGlite eagerly at module load.
- If WASM aborts, the import throws. No recovery code. No diagnostic. The user (or harness operator) has no in-band path to clear the corrupted state.
- `applyMigrations` (called automatically by `apps/server/src/index.ts:33`) would have run successfully if PGlite had initialized — but it never gets a chance.

## Goal

1. Make the corruption recoverable without manual `cd` + `rm -f` shell hacks. A single command restores the server.
2. Keep the recovery conservative: snapshot the corrupted dir before destroying anything; never auto-rehydrate from migrations (operator decides when to wipe + re-bootstrap).
3. Preserve the package's CLI/DI surface — the wrapper is transparent to consumers.

## Non-goals

- Root-cause investigation of why PGlite WASM aborts on certain warm starts. That's a PGlite upstream / WASM-runtime issue; we work around it, not fix it.
- Smoke-test automation. The blast radius — losing the entire PGlite workspace to a smoke test that wiped + re-initialized is too high without explicit operator consent. Out of scope for this change.
- Multiple PGlite instances for the same `databaseDir`. PGlite is single-writer; running two harnesses against the same data dir is already unsupported.

## Design

### 1. Recovery wrapper around `new PGlite(databaseDir)`

`packages/db/src/client.ts` (currently 11 LOC):

```ts
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import fs from 'node:fs';
import path from 'node:path';
import { omegaDatabaseDir } from '@omega/core';
import { PrismaClient } from '../generated/client/index.js';

const databaseDir = omegaDatabaseDir();

function snapshotCorruptDir(dir: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${dir}.corrupt-${stamp}`;
  try {
    fs.renameSync(dir, target);
    console.error(`[PGlite recovery] Snapshot of corrupted data dir created at: ${target}`);
  } catch (err) {
    console.error(`[PGlite recovery] Failed to snapshot ${dir}:`, err instanceof Error ? err.message : err);
  }
}

let pglite: PGlite;
try {
  pglite = new PGlite(databaseDir);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const isAbort = msg.includes('Aborted') || msg.includes('RuntimeError');
  if (isAbort && fs.existsSync(databaseDir)) {
    snapshotCorruptDir(databaseDir);
    throw new Error(
      `PGlite WASM failed to initialize on dir "${databaseDir}". ` +
      `A snapshot of the corrupted dir was just preserved. ` +
      `To recover: delete the snapshot's neighbor dir (now absent), ` +
      `or set OMEGA_DB_RESET=1 in the env and restart to auto-reinitialize. ` +
      `Original error: ${msg}`,
    );
  }
  throw err;
}
const adapter = new PrismaPGlite(pglite);

export { pglite };
export const prisma = new PrismaClient({ adapter });
```

Why the `let` + conditional throw: PGlite can throw at import time. If we want the package to be importable (and inspect the dir) even after a crash, we need the `let` + conditional.

### 2. Reset helper

`packages/db/src/reset.ts` (new file):

```ts
import fs from 'node:fs';
import { omegaDatabaseDir, omegaStorageRoot } from '@omega/core';

/**
 * Wipe and recreate the PGlite data dir. Run from the package entry:
 *   `OMEGA_DB_RESET=1 node packages/db/dist/index.js`
 * Or via the binary after build:
 *   `OMEGA_DB_RESET=1 node -e "require('./packages/db/dist/reset.js').resetDb()"`
 *
 * Not exposed as a CLI subcommand — invocation is deliberate so a misclick
 * can't wipe the DB. Operators must opt in via env var.
 */
export function resetDb(): void {
  const dir = omegaDatabaseDir();
  if (fs.existsSync(dir)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${dir}.manual-reset-${stamp}`;
    fs.renameSync(dir, backup);
    console.error(`[PGlite reset] Moved ${dir} → ${backup}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  console.error(`[PGlite reset] Created fresh empty dir at ${dir}. Restart the server to run migrations + seed.`);
}

if (process.env.OMEGA_DB_RESET === '1') {
  resetDb();
  // After reset, we can construct PGlite safely — fall through to the normal init.
}
```

In `packages/db/src/index.ts` (re-export everything), append:

```ts
export * from './reset.js';
```

### 3. Update `.env.example`

```sh
# PGlite WASM recovery (default: false). When set to '1', the @omega/db package
# will move the existing data dir aside and create a fresh one on next start.
# The next server start re-runs migrations + seed. Existing tasks are wiped.
OMEGA_DB_RESET=0
```

### 4. Logging + diagnostics

The recovery wrapper emits a structured console.error with enough context for an operator to recover:
- The corrupted data dir path.
- The snapshot location (renamed with timestamp).
- The original error message (truncated to ~200 chars to avoid log spam).
- The exact two recovery actions.

We deliberately don't add a structured log library (no winston/pino). `console.error` matches the existing codebase's logging style (e.g., `applyMigrations` already uses `console.log`).

## Data flow

```
1. `import { prisma } from '@omega/db'` runs in apps/server's index.ts.
2. `packages/db/src/client.ts:8` does `new PGlite(databaseDir)`.
3a. (Happy path) PGlite initializes successfully; `prisma` is exported.
3b. (Sad path) PGlite WASM aborts:
   a. Catch the error at `client.ts:13`.
   b. Rename the dir to `${dir}.corrupt-{ts}` (snapshot it).
   c. Throw a new error with the original message + recovery instructions.
4. The server's index.ts sees the error during config load → process exits non-zero.
5. Operator reads the error message, runs `OMEGA_DB_RESET=1 node dist/reset.js` (or deletes the snapshot's neighbor dir).
6. Next server start runs migrations + seed against a fresh DB.
```

## Risks

- **Snapshot rename collision**: if two server processes crash simultaneously, the second `renameSync` may fail because the source dir is already gone. We catch the rename error and log it, then proceed with the new throw — the dir is gone either way.
- **Schema drift**: after a reset, the fresh DB is re-bootstrapped via `applyMigrations` (which `apps/server/src/index.ts:33` calls on boot). All schema columns in the source (incl. the recently-added `currentPhase`, `currentTurn`, etc.) will be present. No manual SQL needed.
- **`OMEGA_DB_RESET` is process-scoped, not persisted**. If `OMEGA_DB_RESET=1` is set the server resets once and the env var remains in the operator's shell — subsequent runs would also reset. We document this in the `.env.example` comment ("check it back to '0' after a recovery").

## Files touched

| File | Change | LOC |
|---|---|---|
| `packages/db/src/client.ts` | Wrap `new PGlite(...)` in try/catch + snapshot helper | +25 |
| `packages/db/src/reset.ts` (new) | Reset helper + standalone invocation | +20 |
| `packages/db/src/index.ts` | Re-export from `./reset.js` | +1 |
| `.env.example` | Document `OMEGA_DB_RESET=0` | +3 |

Total: ~4 files, ~50 LOC.

## Acceptance criteria

1. With a fresh `~/.omega/pglite-data/` (or equivalent `OMEGA_STORAGE_ROOT/pglite-data`), the package imports without error (current behavior, unchanged).
2. With a hand-corrupted dir (junk `postmaster.pid`), running `node packages/db/dist/index.js` (or any import of `@omega/db`) triggers the wrapper, renames the dir, and throws the recovery error.
3. The error message contains: the original `data dir` path, the snapshot path, and both recovery actions (env-gated reset + manual delete).
4. With `OMEGA_DB_RESET=1`, running the reset module moves the dir to `*.manual-reset-{ts}` and creates a fresh empty dir.
5. After reset, the next server boot successfully initializes PGlite (modulo the WASM abort being truly intermittent; if it persists, that's an upstream PGlite issue not in scope).
6. No regression: existing `@omega/db` consumers (server, CLI, agent) see the same `prisma` + `pglite` exports with the same types.
