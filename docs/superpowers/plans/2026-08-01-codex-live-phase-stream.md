# Codex Live Phase Stream Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the current Codex phase (`investigating`/`editing`/`running`/`verifying`/`finalizing`) and elapsed time in that phase as a live, replayable stream during external-agent runs, so users can see what Codex is doing while it works instead of staring at an opaque "build taking too long" error.

**Architecture:** Add three nullable columns to `AgentRun` (`currentPhase`, `currentPhaseStartedAt`, `currentTurn`). The existing Codex `onProgress` callback writes them on transitions to a *known* phase. The existing per-task SSE `agent-run` event payload and the existing `init.agentRun` payload expose them. The web `LiveTaskConsole` and CLI `task watch` render the live phase with an elapsed counter (UI: re-render every 1 s; CLI: computed at event-fire time).

**Tech Stack:** TypeScript, Prisma + PGlite/Postgres, Express + SSE, React (SWC + Vite), Vitest, Commander.

**Spec:** `docs/superpowers/specs/2026-08-01-codex-live-phase-stream-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modify | Add 3 nullable columns to `AgentRun`. |
| `packages/db/prisma/migrations/20260801000000_add_agent_run_current_phase/migration.sql` | Create | Add the columns. |
| `packages/agent/src/external.ts` | Modify | Write `currentTurn: 1` at `agentRun.create`; write `currentPhase` + `currentPhaseStartedAt` on phase transitions in the codex `onProgress` callback. |
| `packages/agent/src/external.test.ts` | Modify | Extend the existing mock-turn test to assert the new DB writes. |
| `apps/server/src/routes/tasks.ts` | Modify | Extend the SSE `agent-run` payload + dedup key (`lastRunKey`) to include the three new fields. |
| `apps/web/src/components/LiveTaskConsole.tsx` | Modify | Extend `LiveAgentRun` interface; render a live phase indicator (live-updating elapsed counter, pulsing dot while running, hidden after `end`). |
| `apps/cli/src/commands/task.ts` | Modify | Print the current phase in `task watch`'s `init` snapshot and `agent-run` event handlers (elapsed at event-fire time). |
| `/tmp/omega-e2e.mjs` | Modify | Extend Section 8 to assert `currentPhase` is set on a live codex run. |

No file is expected to grow unwieldy — all changes are localized (≤40 LOC per file).

---

## Chunk 1: Data Layer — Schema, Migration, External Runner, Unit Test

### Task 1.1: Add new AgentRun columns to Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma:93-118`

- [ ] **Step 1: Add the three columns**

In `packages/db/prisma/schema.prisma`, inside `model AgentRun`, append these lines immediately after the existing `phaseTimings` line (currently line 111):

```prisma
  currentPhase          String?
  currentPhaseStartedAt DateTime?
  currentTurn           Int?
```

The final model block should read (lines 93-118):

```prisma
model AgentRun {
  id                 String          @id @default(uuid())
  taskId             String
  task               Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  promptVersionId    String?
  promptVersion      PromptVersion?  @relation(fields: [promptVersionId], references: [id], onDelete: SetNull)
  branch             String
  baseCommit         String
  resultStatus       String          @default("running")
  validationSummary  String? // JSON
  publishedVersion   String?
  promptTokens       Int?
  completionTokens   Int?
  totalTokens        Int?
  costUsd            Float?
  turnCount          Int?
  toolCalls          String? // JSON: { toolName: count, ... }
  turnDurationMs     Int?
  phaseTimings       String? // JSON: { phaseName: durationMs, ... }
  currentPhase          String?
  currentPhaseStartedAt DateTime?
  currentTurn           Int?
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  @@index([taskId])
  @@index([promptVersionId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `timeout 120 pnpm --filter @omega/db generate 2>&1 | tail -3`
Expected: exit 0, output mentions "Generated Prisma Client".

(The `packages/db/generated/` directory is gitignored — regeneration is local-only.)

- [ ] **Step 3: Verify TypeScript still typechecks**

Run: `timeout 60 pnpm --filter @omega/server build 2>&1 | tail -3`
Expected: exit 0 (the new columns are optional, so no consumer breaks).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add currentPhase, currentPhaseStartedAt, currentTurn to AgentRun"
```

### Task 1.2: Create the Prisma migration

**Files:**
- Create: `packages/db/prisma/migrations/20260801000000_add_agent_run_current_phase/migration.sql`

- [ ] **Step 1: Create the migration file**

Create `packages/db/prisma/migrations/20260801000000_add_agent_run_current_phase/migration.sql` with:

```sql
-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "currentPhase" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "currentPhaseStartedAt" TIMESTAMP(3);
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "currentTurn" INTEGER;
```

(TIMESTAMP(3) matches Prisma's `DateTime` Postgres mapping; on PGlite it works identically.)

- [ ] **Step 2: Verify migration applies on server boot**

Run: `pkill -f 'apps/server/dist/index.js'; sleep 2; OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 & sleep 4; tail -10 /tmp/omega-server.log`
Expected: server logs "Omega harness server on http://127.0.0.1:4000" with no migration errors.

- [ ] **Step 3: Verify the columns exist via Prisma**

Run: `node -e "import('./packages/db/dist/index.js').then(async ({prisma}) => { const cols = await prisma.\$queryRawUnsafe(\`SELECT column_name FROM information_schema.columns WHERE table_name = 'AgentRun' ORDER BY column_name\`); console.log(cols); process.exit(0); })"`
Expected: list includes `currentPhase`, `currentPhaseStartedAt`, `currentTurn`.

(Note: this script uses `import('./packages/db/dist/index.js')`. If your environment loads the client differently, use `node -e "const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient(); ..."` instead.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/migrations/20260801000000_add_agent_run_current_phase/migration.sql
git commit -m "feat(db): migration for AgentRun current phase tracking"
```

### Task 1.3: Write `currentTurn: 1` at agentRun creation in external.ts

**Files:**
- Modify: `packages/agent/src/external.ts:325-332`

- [ ] **Step 1: Update the `prisma.agentRun.create` call**

In `packages/agent/src/external.ts`, change the `agentRun.create` block (currently lines 325-332):

```ts
  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      branch,
      baseCommit: baseCommitSha,
      resultStatus: 'running',
      currentTurn: 1,
    },
  });
```

(Added a single new line: `currentTurn: 1`.)

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 90 pnpm --filter @omega/agent build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 3: Verify the existing unit test still passes**

Run: `timeout 60 pnpm --filter @omega/agent test 2>&1 | tail -10`
Expected: exit 0, both `it()` cases pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/external.ts
git commit -m "feat(agent): initialize currentTurn=1 on agentRun creation"
```

### Task 1.4: Write `currentPhase` + `currentPhaseStartedAt` on Codex phase transitions

**Files:**
- Modify: `packages/agent/src/external.ts:385-389`

- [ ] **Step 1: Extend the `onProgress` callback**

In `packages/agent/src/external.ts`, change the codex `onProgress` callback (currently lines 385-389):

```ts
            onProgress: (message, phase) => {
              runSpan.addEvent('codex.progress', { message, phase: phase ?? undefined });
              const prev = timingTracker.activePhase?.name;
              recordCodexPhaseTransition(timingTracker, phase, Date.now());
              logger.debug(`codex: ${message}`, { taskId, phase: phase ?? undefined });

              if (isCodexPhase(phase) && prev !== phase) {
                void prisma.agentRun.update({
                  where: { id: agentRun.id },
                  data: { currentPhase: phase, currentPhaseStartedAt: new Date() },
                }).catch((err: unknown) => {
                  logger.warn(
                    `Failed to record codex phase: ${err instanceof Error ? err.message : String(err)}`,
                    { taskId },
                  );
                });
              }
            },
```

(`isCodexPhase` is the existing type-guard at `external.ts:30` — no new imports needed.)

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 90 pnpm --filter @omega/agent build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 3: Verify the existing unit test still passes**

Run: `timeout 60 pnpm --filter @omega/agent test 2>&1 | tail -10`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/external.ts
git commit -m "feat(agent): persist current Codex phase to AgentRun on transitions"
```

### Task 1.5: Extend the unit test to assert the new DB writes

**Files:**
- Modify: `packages/agent/src/external.test.ts:76-190`

- [ ] **Step 1: Add assertions for `currentTurn` at creation**

In `packages/agent/src/external.test.ts`, inside the first test's `expect(agentRunUpdate)` block (around lines 157-170), keep the existing assertion but add a new one BEFORE the final `expect(agentRunUpdate)` that asserts `currentTurn` is captured at `agentRun.create` time. The cleanest path is to add a new `it` that asserts the `create` call directly:

```ts
  it('initializes currentTurn=1 at agentRun creation', async () => {
    const agentRunCreate = vi.fn().mockResolvedValue({ id: 'run-1' });
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Test task',
          description: 'Test description',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: agentRunCreate,
        update: agentRunUpdate,
      },
      taskDiff: {
        create: vi.fn().mockResolvedValue({}),
      },
      traceSpan: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 1_000,
    });

    expect(agentRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ currentTurn: 1 }),
    });
  });
```

Append this new `it` block at the end of the `describe('runExternalAgentTask')` block (after the existing two `it`s, before line 264's closing `});`).

- [ ] **Step 2: Add assertions for `currentPhase` writes on transitions**

In the existing first `it` block (lines 77-190), inside the `expect(agentRunUpdate)` block (lines 157-170), add an assertion that at least one of the `agentRun.update` calls included `currentPhase: 'verifying'`:

```ts
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        currentPhase: 'verifying',
        currentPhaseStartedAt: expect.any(Date),
      }),
    });
```

Place this new assertion immediately AFTER the existing `expect(agentRunUpdate).toHaveBeenCalledWith(...)` (after line 170).

- [ ] **Step 3: Run the tests**

Run: `timeout 60 pnpm --filter @omega/agent test 2>&1 | tail -15`
Expected: exit 0, 3 `it` cases pass (the original 2 + the new `currentTurn` one).

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/external.test.ts
git commit -m "test(agent): assert currentTurn=1 at agentRun creation and currentPhase writes on transitions"
```

### Task 1.6: Verify Chunk 1 builds end-to-end

- [ ] **Step 1: Full server build**

Run: `timeout 90 pnpm --filter @omega/server build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 2: Restart server and confirm migration applied**

Run:
```bash
pkill -f 'apps/server/dist/index.js' || true
sleep 2
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 4
tail -10 /tmp/omega-server.log
```
Expected: server boots cleanly, no migration errors.

- [ ] **Step 3: Smoke test the agent-run endpoint**

Run:
```bash
curl -s "http://127.0.0.1:4000/tasks/4ebe0a81-a1a3-49a0-b0b2-2ceda2d5b55f/agent-run" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.log('keys:',Object.keys(t).join(','))})"
```
Expected: response includes `currentPhase`, `currentPhaseStartedAt`, `currentTurn` (all `null` on this pre-existing run since it pre-dates the migration).

- [ ] **Step 4: No commit needed — verification step only.**

---

## Chunk 2: SSE Payload + CLI Watch Handlers

### Task 2.1: Extend the SSE `agent-run` event payload + dedup key

**Files:**
- Modify: `apps/server/src/routes/tasks.ts:156-158` (lastRunKey initialization)
- Modify: `apps/server/src/routes/tasks.ts:239-251` (agent-run send block)

- [ ] **Step 1: Extend the `lastRunKey` initialization**

In `apps/server/src/routes/tasks.ts`, replace lines 156-158:

```ts
    let lastRunKey = agentRun
      ? `${agentRun.resultStatus}:${String(agentRun.totalTokens ?? '')}:${String(agentRun.updatedAt.getTime())}:${String(agentRun.currentPhase ?? '')}:${String(agentRun.currentPhaseStartedAt?.getTime() ?? '')}:${String(agentRun.currentTurn ?? '')}`
      : '';
```

- [ ] **Step 2: Extend the `agent-run` event payload**

In `apps/server/src/routes/tasks.ts`, replace lines 239-251 (the `if (key !== lastRunKey)` block):

```ts
        if (run) {
          const key = `${run.resultStatus}:${String(run.totalTokens ?? '')}:${String(run.updatedAt.getTime())}:${String(run.currentPhase ?? '')}:${String(run.currentPhaseStartedAt?.getTime() ?? '')}:${String(run.currentTurn ?? '')}`;
          if (key !== lastRunKey) {
            lastRunKey = key;
            send('agent-run', {
              id: run.id,
              resultStatus: run.resultStatus,
              branch: run.branch,
              baseCommit: run.baseCommit,
              promptTokens: run.promptTokens ?? undefined,
              completionTokens: run.completionTokens ?? undefined,
              totalTokens: run.totalTokens ?? undefined,
              promptVersionId: run.promptVersionId ?? undefined,
              currentPhase: run.currentPhase ?? undefined,
              currentPhaseStartedAt: run.currentPhaseStartedAt?.toISOString() ?? undefined,
              currentTurn: run.currentTurn ?? undefined,
            });
          }
        }
```

(The `init` event at line ~160 sends the full `agentRun` row already — `currentPhase` etc. will flow through automatically via JSON serialization. No change needed there.)

- [ ] **Step 3: Verify it typechecks**

Run: `timeout 90 pnpm --filter @omega/server build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 4: Restart server and verify init payload exposes the fields**

Run:
```bash
pkill -f 'apps/server/dist/index.js' || true
sleep 2
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 4
```
Then run:
```bash
timeout 6 curl -sN "http://127.0.0.1:4000/tasks/4ebe0a81-a1a3-49a0-b0b2-2ceda2d5b55f/stream" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=d.match(/event: init\ndata: ({[^]*?})\n\n/);if(!m){console.log('no init');return}const ar=JSON.parse(m[1]).agentRun;console.log('currentPhase:',ar.currentPhase,'currentTurn:',ar.currentTurn,'currentPhaseStartedAt:',ar.currentPhaseStartedAt)})"
```
Expected: prints `currentPhase: null currentTurn: null currentPhaseStartedAt: null` (this run pre-dates the migration).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/tasks.ts
git commit -m "feat(server): expose currentPhase/StartedAt/turn in agent-run SSE payload"
```

### Task 2.2: Extend CLI `task watch` init handler to print the current phase

**Files:**
- Modify: `apps/cli/src/commands/task.ts:159-174`

- [ ] **Step 1: Extend the init handler's `parts` array**

In `apps/cli/src/commands/task.ts`, in the `case 'init':` block inside `onFrame` (around lines 159-174), add current-phase info to the agentRun summary. Replace the inner `if (agentRun) { ... }` block (lines 159-174) with:

```ts
        if (agentRun) {
          const parts: string[] = [];
          if (typeof agentRun.turnDurationMs === 'number') {
            parts.push(`turn=${Math.round(agentRun.turnDurationMs / 1000)}s`);
          }
          const phase = agentRun.phaseTimings;
          if (phase && typeof phase === 'object') {
            const phases = Object.entries(phase as Record<string, unknown>)
              .map(([k, v]) => `${k}:${Math.round(Number(v) / 1000)}s`)
              .join(',');
            parts.push(`phases=${phases}`);
          }
          if (typeof agentRun.currentPhase === 'string') {
            const phasePart = `phase=${agentRun.currentPhase}`;
            const startedAt = typeof agentRun.currentPhaseStartedAt === 'string'
              ? agentRun.currentPhaseStartedAt
              : null;
            const elapsed = startedAt
              ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000))
              : null;
            parts.push(elapsed !== null ? `${phasePart}(${elapsed}s)` : phasePart);
          }
          if (typeof agentRun.totalTokens === 'number') parts.push(`tokens=${agentRun.totalTokens}`);
          if (typeof agentRun.branch === 'string') parts.push(`branch=${agentRun.branch}`);
          if (parts.length > 0) console.log(`[${ts}] agentRun: ${parts.join('  ')}`);
        }
```

(Added a new `currentPhase` branch that computes elapsed at event-fire time.)

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 90 pnpm --filter @omega/cli build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/commands/task.ts
git commit -m "feat(cli): print currentPhase with elapsed in task watch init snapshot"
```

### Task 2.3: Extend CLI `task watch` `agent-run` event handler

**Files:**
- Modify: `apps/cli/src/commands/task.ts:190-196`

- [ ] **Step 1: Extend the `agent-run` event handler**

In `apps/cli/src/commands/task.ts`, replace the `case 'agent-run':` block (lines 190-196):

```ts
      case 'agent-run': {
        const parts: string[] = [];
        if (typeof parsed.resultStatus === 'string') parts.push(`status=${parsed.resultStatus}`);
        if (typeof parsed.totalTokens === 'number') parts.push(`tokens=${parsed.totalTokens}`);
        if (typeof parsed.currentPhase === 'string') {
          const phasePart = `phase=${parsed.currentPhase}`;
          const startedAt = typeof parsed.currentPhaseStartedAt === 'string'
            ? parsed.currentPhaseStartedAt
            : null;
          const elapsed = startedAt
            ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000))
            : null;
          parts.push(elapsed !== null ? `${phasePart}(${elapsed}s)` : phasePart);
        }
        if (parts.length > 0) console.log(`[${ts}] agentRun update: ${parts.join('  ')}`);
        break;
      }
```

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 90 pnpm --filter @omega/cli build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/commands/task.ts
git commit -m "feat(cli): print currentPhase with elapsed in task watch agent-run events"
```

### Task 2.4: Smoke test the CLI watch on a finished task

- [ ] **Step 1: Run `task watch` against the pre-existing codex task 4ebe0a81**

Run:
```bash
timeout -s INT 10 node apps/cli/dist/index.js task watch 4ebe0a81 2>&1 | grep -v Warning | grep -v trace-warnings
```
Expected: output shows the agentRun init line including any populated currentPhase/currentTurn fields (will be `null` for this pre-migration run).

- [ ] **Step 2: No commit needed — verification step only.**

---

## Chunk 3: Web UI + E2E + Final Verification

### Task 3.1: Extend `LiveAgentRun` interface

**Files:**
- Modify: `apps/web/src/components/LiveTaskConsole.tsx:42-54`

- [ ] **Step 1: Add three optional fields**

In `apps/web/src/components/LiveTaskConsole.tsx`, replace the `LiveAgentRun` interface (lines 42-54) with:

```ts
interface LiveAgentRun {
  id: string;
  resultStatus: string;
  branch: string;
  baseCommit: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptVersionId?: string;
  turnDurationMs?: number;
  phaseTimings?: string;
  currentPhase?: string;
  currentPhaseStartedAt?: string;
  currentTurn?: number;
}
```

(Added three optional fields at the end.)

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 90 pnpm --filter @omega/web build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 3: No commit yet — continue to Task 3.2.**

### Task 3.2: Add a live-updating phase indicator to the agent run summary

**Files:**
- Modify: `apps/web/src/components/LiveTaskConsole.tsx:181-187` (state declarations)
- Modify: `apps/web/src/components/LiveTaskConsole.tsx:301-307` (render block, just after `Turn duration`)

- [ ] **Step 1: Add a `now` state and a 1-second tick `useEffect`**

In `apps/web/src/components/LiveTaskConsole.tsx`, immediately after line 187 (`const traceBoxRef = useRef<HTMLDivElement | null>(null);`), add:

```ts
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (ended) return undefined;
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
  }, [ended]);
```

- [ ] **Step 2: Add the phase indicator render block**

In `apps/web/src/components/LiveTaskConsole.tsx`, immediately after the `Turn duration` block (after line 306), add:

```tsx
            {agentRun.currentPhase && !ended && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Current phase</span>
                <span className="flex items-center gap-1.5">
                  {agentRun.resultStatus === 'running' && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                  )}
                  <span>
                    phase={agentRun.currentPhase}
                    {agentRun.currentPhaseStartedAt && (
                      <>
                        {' '}
                        ({formatDuration(now - new Date(agentRun.currentPhaseStartedAt).getTime())})
                      </>
                    )}
                  </span>
                </span>
              </div>
            )}
```

The phase indicator:
- Renders only when `currentPhase` is set AND `ended` is false (after the `end` SSE event fires, the indicator disappears entirely).
- Shows a pulsing yellow dot only while `resultStatus === 'running'`.
- Uses the existing `formatDuration(ms)` helper (defined at `LiveTaskConsole.tsx:128`) to render `134s` / `2m14s`.

- [ ] **Step 3: Verify it builds**

Run: `timeout 90 pnpm --filter @omega/web build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/LiveTaskConsole.tsx
git commit -m "feat(web): live current-phase indicator in LiveTaskConsole"
```

### Task 3.3: Copy the rebuilt bundle to the server's web dir

- [ ] **Step 1: Clear stale Vite cache and rebuild**

Run:
```bash
rm -rf apps/web/node_modules/.vite apps/web/dist
timeout 90 pnpm --filter @omega/web build 2>&1 | tail -5
```
Expected: exit 0; the dist directory contains new hashed `index-*.js` + `index-*.css` files.

- [ ] **Step 2: Wipe stale hashed assets from the server web dir, then copy fresh ones**

`packages/bundle/copy:web:server` copies to `packages/bundle/dist/server/web` (used by the bundle build), NOT `apps/server/web`. For local-dev iteration we copy directly:

```bash
# Ensure the target dir exists (idempotent on existing checkouts).
mkdir -p apps/server/web/assets
# Clear all hashed assets so old bundles from previous builds don't accumulate.
rm -f apps/server/web/assets/index-*.js apps/server/web/assets/index-*.css
# Copy the fresh bundle.
cp apps/web/dist/index.html apps/server/web/index.html
cp apps/web/dist/assets/index-*.js apps/server/web/assets/
cp apps/web/dist/assets/index-*.css apps/server/web/assets/
ls apps/server/web/assets/
```
Expected: `apps/server/web/assets/` contains only the new `index-*.js` + `index-*.css` files (no stale hashed assets).

- [ ] **Step 3: Restart the server**

Run:
```bash
pkill -f 'apps/server/dist/index.js' || true
sleep 2
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 4
tail -5 /tmp/omega-server.log
```
Expected: server boots cleanly.

- [ ] **Step 4: Verify the new bundle is served**

Run:
```bash
curl -s http://127.0.0.1:4000/ | grep -oE 'index-[A-Za-z0-9_-]+\.(js|css)'
```
Expected: prints the new hash.

- [ ] **Step 5: No commit needed (server web dir is gitignored).**

### Task 3.4: Extend the E2E script's Section 8 to assert `currentPhase` is set

**Files:**
- Modify: `/tmp/omega-e2e.mjs` — the Section 8 block (live codex attach)

- [ ] **Step 1: Add a currentPhase poll that runs concurrently with the stream**

In `/tmp/omega-e2e.mjs`, in Section 8 (`8. Live codex attach`), **before** the existing `try` block (so the poller is always defined), add:

```js
  const KNOWN_PHASES = ['investigating', 'editing', 'running', 'verifying', 'finalizing'];
  let observedCurrentPhase: string | null = null;
  let observedCurrentTurn: number | null = null;
  let pollP: Promise<void> = Promise.resolve();
```

Then, **inside** the `try` block, immediately after the `check('POST /tasks/:id/run (live codex) returns 202', run.status === 202);` line and BEFORE `await Promise.race([streamP, sleep(45_000)])`, replace the `// Race:` comment with:

```js
    // Poll the agentRun endpoint for currentPhase while the run executes.
    pollP = (async () => {
      const pollStart = Date.now();
      while (Date.now() - pollStart < 35_000) {
        const ar = await api(`/tasks/${liveId}/agent-run`);
        if (ar.ok && ar.body && typeof ar.body.currentPhase === 'string') {
          observedCurrentPhase = ar.body.currentPhase;
          observedCurrentTurn = ar.body.currentTurn;
          return;
        }
        await sleep(2000);
      }
    })();
```

Also, **after** the existing `check('live task event fired while attached', ...)` line and before `await sleep(30_000)` (the test cleanup), add:

```js
  await pollP;
  check('currentPhase populated on running codex task',
    typeof observedCurrentPhase === 'string' && KNOWN_PHASES.includes(observedCurrentPhase),
    `observedCurrentPhase=${String(observedCurrentPhase)} observedCurrentTurn=${String(observedCurrentTurn)}`);
  check('currentTurn populated (=1 on first turn)',
    observedCurrentTurn === 1,
    `observedCurrentTurn=${String(observedCurrentTurn)}`);
```

The poll window is 35 s (above the spec's 30 s minimum) to give codex enough time to enter its first known phase even on a fast run. `pollP` is always defined (initialized to a no-op `Promise.resolve()` outside the try), so the await is safe even if the run request itself threw before the poller was assigned.

- [ ] **Step 2: Run the E2E**

Run: `timeout 240 node /tmp/omega-e2e.mjs 2>&1 | tail -8`
Expected: `Summary  …passed, 0 failed` (exact check count varies — we added 2 assertions, but some checks in earlier sections may skip on env). Exit 0.

- [ ] **Step 3: No commit — `/tmp/omega-e2e.mjs` is outside the repo.**

### Task 3.5: Full smoke verification (per AGENTS.md)

- [ ] **Step 1: All package builds pass (per AGENTS.md §4)**

Run:
```bash
timeout 240 pnpm -r build 2>&1 | tail -10
```
Expected: exit 0; all packages (agent, server, cli, web, db, providers, router, bundle) report successful builds.

- [ ] **Step 2: Repo-wide lint (per AGENTS.md §4)**

Run: `timeout 60 node node_modules/eslint/bin/eslint.js packages/agent/src apps/server/src apps/cli/src apps/web/src 2>&1 | tail -20`
Expected: exit 0 (or known-skipped file count if `.eslintignore` excludes some files).

Use the explicit `node node_modules/eslint/bin/eslint.js` invocation — running `pnpm lint` triggers this session's intermittent spawn quirk.

- [ ] **Step 3: Agent unit tests pass**

Run: `timeout 60 pnpm --filter @omega/agent test 2>&1 | tail -10`
Expected: exit 0, all `it` cases pass (3 now: the original 2 + the new `currentTurn` one).

- [ ] **Step 4: Restart server with new bundle**

Run:
```bash
pkill -f 'apps/server/dist/index.js' || true
sleep 2
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 4
tail -5 /tmp/omega-server.log
```
Expected: server boots cleanly, no migration errors.

- [ ] **Step 5: Run the full E2E one final time**

Run: `timeout 300 node /tmp/omega-e2e.mjs 2>&1 | tail -8`
Expected: `Summary  …passed, 0 failed`, exit 0. The exact check count is not asserted (some checks in earlier sections may skip on env). 300 s gives headroom over the cumulative 90 s (Section 2) + 45 s (Section 8) + per-section overhead.

- [ ] **Step 6: Manual smoke — CLI `task watch` against a finished codex task**

Run:
```bash
timeout -s INT 10 node apps/cli/dist/index.js task watch 4ebe0a81 2>&1 | grep -v Warning | grep -v trace-warnings
```
Expected: shows the agentRun init line (pre-migration run will have `currentPhase: null`; post-migration runs will show the live phase).

- [ ] **Step 7: No commit — verification step only.**