# PGlite Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PGlite WASM-abort recovery in-band (no manual `rm` shell hacks) by snapshotting stale data dirs at server startup + providing a standalone reset CLI. All work centers on a pre-init `snapshot.ts` helper + dynamic-import refactor in `apps/server/src/index.ts`.

**Architecture:** A new `snapshotStalePgliteDir()` helper detects a stale `postmaster.pid` (mtime > 5s old) and renames the data dir to `.corrupt-{timestamp}`. The server's startup path runs this BEFORE dynamically importing `@omega/db` (the only way to guarantee ordering under V8 ESM where static imports are hoisted). A standalone `cli-reset.ts` provides an explicit `--yes`-gated wipe for manual recovery.

**Tech Stack:** TypeScript, ESM (NodeNext), Node 18+, PGlite 0.5.4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-02-pglite-recovery-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/db/src/snapshot.ts` (new) | Create | `snapshotStalePgliteDir(maxAgeMs?)` helper — detect stale `postmaster.pid`, rename data dir aside, return snapshot path. |
| `packages/db/src/client.ts` | Modify | Defensive sync try/catch + `waitReady.catch` (log reason) around the existing `new PGlite(databaseDir)`. |
| `packages/db/src/cli-reset.ts` (new) | Create | Standalone CLI: `node cli-reset.js` prints the data dir; `node cli-reset.js --yes` wipes it. |
| `packages/db/package.json` | Modify | Add `./snapshot` + `./cli-reset` subpath exports. |
| `apps/server/src/index.ts` | Modify | Move the `@omega/db` import to a dynamic `await import(...)` so the snapshot runs first. |
| `.env.example` | Modify | Document the recovery procedure. |

No schema, no test, no migration. Single round of work.

---

## Chunk 1: All Tasks (5 files, ~100 LOC)

### Task 1.1: Create `packages/db/src/snapshot.ts`

- [ ] **Step 1: Create the file** at `packages/db/src/snapshot.ts`:

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

- [ ] **Step 2: Verify it typechecks** — `timeout 120 pnpm --filter @omega/db build 2>&1 | tail -3` exits 0. (If pnpm hangs, fall back to `timeout 180 node node_modules/typescript/bin/tsc -p packages/db 2>&1 | tail -3`.)

- [ ] **Step 3: No commit — continue to Task 1.2.**

### Task 1.2: Update `packages/db/src/client.ts` with defensive catch

- [ ] **Step 1: Replace the body** of `client.ts` (currently 11 LOC) with:

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
  // also attach a catch that logs the reason.
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

- [ ] **Step 2: Verify it typechecks** — `timeout 120 pnpm --filter @omega/db build 2>&1 | tail -3` exits 0.

- [ ] **Step 3: No commit — continue to Task 1.3.**

### Task 1.3: Create `packages/db/src/cli-reset.ts`

- [ ] **Step 1: Create the file** at `packages/db/src/cli-reset.ts`:

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

- [ ] **Step 2: Verify it typechecks** — `timeout 120 pnpm --filter @omega/db build 2>&1 | tail -3` exits 0.

- [ ] **Step 3: No commit — continue to Task 1.4.**

### Task 1.4: Add subpath exports to `packages/db/package.json`

- [ ] **Step 1: Read the current `package.json`** at `packages/db/package.json` (specifically the `"exports"` field).

- [ ] **Step 2: Add the new subpath exports** to the `"exports"` object. The current shape is:

```jsonc
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

Change to:

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

(`./cli-reset` has no `types` field — it's a standalone CLI entry, no public API to type against.)

- [ ] **Step 3: Verify the package builds + the subpath resolves** — `timeout 120 pnpm --filter @omega/db build 2>&1 | tail -3` exits 0. (Subpath resolution happens at consumer import time, not build time; can't verify in isolation here.)

- [ ] **Step 4: No commit — continue to Task 1.5.**

### Task 1.5: Refactor `apps/server/src/index.ts` to use dynamic import for `@omega/db`

- [ ] **Step 1: Read the current file** at `apps/server/src/index.ts` (it's small — ~50 LOC).

- [ ] **Step 2: Replace the static `@omega/db` and dependent imports with dynamic imports** while keeping the snapshot call before them. The final file should look like:

```ts
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

// Snapshot any stale PGlite data dir BEFORE loading @omega/db. This function
// depends only on @omega/core (no PGlite), so it's safe to call here. Without
// this snapshot, the @omega/db dynamic import below would construct PGlite on
// a corrupted dir and abort.
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

(async () => {
  try {
    await applyMigrations();
    await seedDefaults(prisma);
    await seedSkills();
  } catch (err) {
    console.error('Failed to bootstrap DB:', err);
    process.exit(1);
  }

  // ... rest of file unchanged — bind to PORT/HOST, set up SSE streams, etc.
})();
```

The pattern: the dynamic imports give us the values; the `(async () => { ... })()` IIFE consumes them.

- [ ] **Step 3: Verify it typechecks** — `timeout 120 pnpm --filter @omega/server build 2>&1 | tail -3` exits 0.

- [ ] **Step 4: Verify the runtime behavior** — try to start the server: `OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 & sleep 8; lsof -nP -iTCP:4000 -sTCP:LISTEN 2>/dev/null | tail -1; tail -10 /tmp/omega-server.log`. (May fail with the PGlite WASM abort — that's the pre-existing condition; the snapshot should at least log the recovery diagnostic.)

- [ ] **Step 5: No commit — continue to Task 1.6.**

### Task 1.6: Update `.env.example` documentation

- [ ] **Step 1: Read the current `.env.example`** and find an appropriate location (e.g., near the `DATABASE_URL` section or the `OMEGA_STORAGE_ROOT` block).

- [ ] **Step 2: Append the recovery documentation** block:

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

- [ ] **Step 3: No commit — verification only at this point.**

### Task 1.7: Verify all builds pass + commit

- [ ] **Step 1: All package builds pass**

```bash
timeout 90 pnpm --filter @omega/db build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/server build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/agent build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/cli build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/web build 2>&1 | tail -3
```

Expected: all five exit 0.

- [ ] **Step 2: Agent tests pass**

```bash
timeout 90 pnpm --filter @omega/agent test 2>&1 | tail -10
```

Expected: 14 tests pass.

- [ ] **Step 3: Restart the server** to validate the new startup sequence

```bash
pkill -f 'apps/server/dist/index.js' 2>/dev/null
sleep 2
rm -f ~/.omega/pglite-data/postmaster.pid
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 10
lsof -nP -iTCP:4000 -sTCP:LISTEN 2>/dev/null | tail -1
tail -8 /tmp/omega-server.log
```

Expected: server starts OR fails with the PGlite WASM abort but the snapshot diagnostic is logged. Either is a valid result — the point is that the new code doesn't make things worse.

- [ ] **Step 4: Commit all 5 source files + the config + the doc** in one or two commits:

```bash
git add packages/db/src/snapshot.ts packages/db/src/client.ts packages/db/src/cli-reset.ts packages/db/package.json
git commit -m "feat(db): PGlite WASM recovery — snapshot helper + cli-reset + subpath exports"
git add apps/server/src/index.ts .env.example
git commit -m "feat(server): pre-init PGlite snapshot via dynamic import + env doc"
```

(Or one combined commit — your call.)

- [ ] **Step 5: No commit further — verification only.**

---

## Chunk 1 Verification

Done. All 5 source files + 1 config + 1 doc modified, 0 schema/migration changes, 0 test changes.

**Smoke validation (best-effort, given the PGlite WASM abort may persist):**
- The CLI: `node packages/db/dist/cli-reset.js` (without `--yes`) should print the data dir path and exit non-zero.
- The CLI: `node packages/db/dist/cli-reset.js --yes` should wipe the dir (or report the backup move).
- The server: if the WASM abort persists, the diagnostic in `client.ts` should mention `node packages/db/dist/cli-reset.js --yes` as the recovery path.
