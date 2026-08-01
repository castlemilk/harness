# Codex Live Phase Stream — Design

**Date:** 2026-08-01
**Status:** Draft (pre-implementation)
**Owner:** Omega harness

## Problem

The harness's external-agent runner (especially the Codex app-server path) often surfaces failures with an opaque message such as:

> `External agent (codex) failed. The build is taking longer than usual in the workspace but has not reported an error. I'm letting it finish rather than interrupting the verification run.`

This came up repeatedly while running real Codex tasks during the `harness task watch` work (e.g. `b901d9fb`, `d2ac5d15`): the user can't tell whether Codex is still doing useful work, stuck on a verification command, or has actually hung. The final `phaseTimings` (cumulative ms per phase) and `turnDurationMs` are recorded on `AgentRun`, but they're only visible **after** the run finishes — they don't help during a live run.

We have the per-phase progress events already (`codex.progress` span events carrying `{message, phase}`), but they're only persisted as span-event JSON, not surfaced to the live stream.

## Goal

While a Codex-driven task is running, expose the **current Codex phase** (`investigating` / `editing` / `running` / `verifying` / `finalizing`) and **elapsed time in that phase**, so the user can see what Codex is actually doing and decide whether a long-running verification is healthy or stuck.

Out of scope (per user direction — "current phase + per-phase timing only"):

- A scrollable log of all `codex.progress` events (those remain on the trace span).
- Structured failure root-cause parsing of the final Codex output.
- Other CLI backends (claude-code, agy, opencode, etc.).

## Non-goals

- Changing the Codex driver or the phase definitions.
- Streaming cumulative per-phase running totals (the final `phaseTimings` already covers this at end of run).
- Adding a new SSE event type — we'll extend the existing `agent-run` event payload.

## Design

### 1. New AgentRun fields

`packages/db/prisma/schema.prisma`:

```prisma
model AgentRun {
  // ... existing fields ...
  currentPhase          String?   // one of investigating|editing|running|verifying|finalizing
  currentPhaseStartedAt DateTime?
  currentTurn           Int?
}
```

Migration: `packages/db/prisma/migrations/20260801000000_add_agent_run_current_phase/migration.sql` — additive, no defaults required (all nullable).

The Prisma `generated/` client is gitignored and regenerated locally.

### 2. Codex phase writes in `packages/agent/src/external.ts`

The existing `onProgress` callback in the Codex branch (around line 385) already calls `recordCodexPhaseTransition(timingTracker, phase, Date.now())`. We extend it so that **on every phase change**, the agentRun row is updated with the new phase + start time:

```ts
onProgress: (message, phase) => {
  runSpan.addEvent('codex.progress', { message, phase: phase ?? undefined });
  const prev = timingTracker.activePhase?.name;
  recordCodexPhaseTransition(timingTracker, phase, Date.now());
  logger.debug(`codex: ${message}`, { taskId, phase: phase ?? undefined });

  if (isCodexPhase(phase) && prev !== phase) {
    void prisma.agentRun.update({
      where: { id: agentRunId },
      data: { currentPhase: phase, currentPhaseStartedAt: new Date() },
    }).catch((err) => {
      logger.warn(`Failed to record codex phase: ${err instanceof Error ? err.message : String(err)}`, { taskId });
    });
  }
}
```

The fire-and-forget `.catch` pattern keeps a telemetry write from failing the run. `prev !== phase` ensures we only write on actual transitions, not on every progress message (which fires dozens of times per turn).

`currentTurn` is set once per turn (default `1`). Multi-turn Codex support isn't built yet, but the field is in place for when it lands.

### 3. SSE `agent-run` event payload

`apps/server/src/routes/tasks.ts` — the existing `agent-run` event (line ~227-236) sends a subset of agentRun fields. We extend the payload and the dedup key:

```ts
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
```

And the `lastRunKey` (line ~156) is extended to include those three fields so updates propagate.

The `init` event's `agentRun` payload (line ~160) already serializes the full agentRun row, so `currentPhase` etc. will be included automatically — no change needed there.

### 4. LiveTaskConsole UI

`apps/web/src/components/LiveTaskConsole.tsx`:

- Extend `LiveAgentRun` interface with `currentPhase?: string`, `currentPhaseStartedAt?: string`, `currentTurn?: number`.
- Render a "Current phase" line in the agent-run summary block (just below `resultStatus`):
  - Text: `phase=verifying (2m14s)` where the elapsed counter is a live-updating relative time (re-render every 1 s via a `useEffect` interval that calls `setNow(Date.now())` while the task is running).
  - When `resultStatus === 'running'` and `currentPhase` is set, show a pulsing dot in the phase's color.
- On phase-change events from the SSE stream, the existing `agent-run` listener updates the `agentRun` state, triggering re-render.

### 5. CLI `task watch`

`apps/cli/src/commands/task.ts`:

- Extend the `init` snapshot's agentRun summary to print `phase=verifying (2m14s)` when `currentPhase` is present.
- Extend the `agent-run` event handler to print `agentRun: phase=verifying (2m14s)` on updates.
- The liveness dot in `task watch` already ticks every 15 s; the phase transition lines will appear interleaved with it.

### 6. Tests

**Unit (`packages/agent/src/external.test.ts`):** Extend the existing fake-codex test to assert that when the fake codex emits a `phase=verifying` progress event, the resulting agentRun has `currentPhase: 'verifying'` and `currentPhaseStartedAt` set.

**E2E (`/tmp/omega-e2e.mjs`):** Add a Section 9 check: while a live codex task is running, `GET /tasks/:id/agent-run` returns `currentPhase` populated (one of the known phases) and `currentPhaseStartedAt` within the last few minutes. This validates the DB write path under a real Codex run.

## Data flow

```
codex-progress event (from codex app-server)
  ↓
runCodexTurn.onProgress(message, phase)
  ↓
external.ts: recordCodexPhaseTransition(tracker, phase, ts)
  ↓
if phase changed: prisma.agentRun.update({ currentPhase, currentPhaseStartedAt })
                                       ↓
server tick (500ms) detects updatedAt change
                                       ↓
emits `agent-run` event with new currentPhase + currentPhaseStartedAt
                                       ↓
LiveTaskConsole re-renders phase line with live elapsed counter
CLI task watch prints phase=verifying 2m14s
```

## Error handling

- DB write failure on phase update → logged at `warn`, run continues. The phase still tracks correctly in-memory for the `finishCodexTiming` totals.
- Phase value outside the known enum → `isCodexPhase` guards the DB write; unknown phases are still recorded on the span event but don't pollute `currentPhase`.
- Server restart mid-run → the latest phase is in the DB; `init.agentRun` replays it. The elapsed counter starts from `currentPhaseStartedAt`, so the user sees accurate "X seconds into phase Y" on re-attach.

## Risks

- **DB write amplification:** Codex may transition phases ~5–20 times per task. Writes are cheap (SQLite/Postgres single-row update). Acceptable.
- **Stale `currentPhase` after the run ends:** We don't clear `currentPhase` on completion. The `LiveTaskConsole` UI should hide the live phase indicator when `resultStatus !== 'running'`. Doc this in the component.
- **Migration on a live DB:** The additive migration adds nullable columns, which is safe on both Postgres and PGlite. The server's boot-time migration auto-applies it on next restart.

## Files touched

- `packages/db/prisma/schema.prisma` — 3 new AgentRun fields.
- `packages/db/prisma/migrations/20260801000000_add_agent_run_current_phase/migration.sql` — new migration.
- `packages/agent/src/external.ts` — extend `onProgress` callback (~10 lines).
- `packages/agent/src/external.test.ts` — extend fake-codex test (~20 lines).
- `apps/server/src/routes/tasks.ts` — extend `agent-run` event payload + dedup key (~8 lines).
- `apps/web/src/components/LiveTaskConsole.tsx` — render phase + live counter (~40 lines).
- `apps/cli/src/commands/task.ts` — print phase in init + agent-run handlers (~6 lines).
- `/tmp/omega-e2e.mjs` — add Section 9 (~20 lines).

## Acceptance criteria

1. The Prisma migration applies cleanly on boot.
2. `agentRun.currentPhase` is populated within a few seconds of a Codex phase transition.
3. The SSE `agent-run` event payload includes `currentPhase`, `currentPhaseStartedAt`, `currentTurn`.
4. The `LiveTaskConsole` renders the current phase with a live-updating "elapsed in phase" counter, and stops animating when `resultStatus !== 'running'`.
5. The CLI `task watch` prints phase transition lines on `agent-run` events.
6. Re-attaching to a running task via `harness task watch <short-id>` shows the current phase on init.
7. The new unit test passes; the extended E2E passes.
8. The web bundle builds cleanly (`pnpm --filter @omega/web build` → tsc + vite build, exit 0).
9. The server bundle builds cleanly (`pnpm --filter @omega/server build` → tsc, exit 0).