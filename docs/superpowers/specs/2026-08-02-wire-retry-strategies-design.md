# Wire the Unwired Retry Strategies — Design

**Date:** 2026-08-02
**Status:** Draft (pre-implementation)
**Owner:** Omega harness

## Problem

We kept hitting codex failures this session — `b901d9fb`, `d2ac5d15`, the E2E's live-attach runs — almost all of them the same "build taking too long" verification-hang outcome. The infrastructure for handling this is declared but not wired:

- `apps/server/src/lib/retry-strategies.ts` declares 5 strategies (`clean-retry`, `tier-escalation`, `different-provider`, `orchestrated-fallback`, `different-cli`).
- `tier-escalation` and `different-provider` declare *intent* but return `{ strategy: 'tier-escalation' }` with no concrete model/provider — they're placeholders.
- `executeRetry` ignores `attempt.model` / `attempt.provider` when calling `runAgentTask` / `runExternalAgentTask` — only `attempt.cli` is honored (and even then, the new tag-array it constructs at lines 149-154 is dead code that never reaches the task row).
- `OMEGA_AUTO_RETRY` defaults to `false`, so all 5 strategies are inert unless a user explicitly sets the env var.

The result: every failure we hit today terminates with the same opaque "External agent (codex) failed. The build is taking longer than usual..." message and requires a manual re-launch via `POST /tasks/:id/run` with the same provider/model that just failed.

## Goal

Make retry actually work end-to-end:

1. `tier-escalation` and `different-provider` pick concrete model + provider values.
2. `executeRetry` honors those values when calling the runner.
3. The task row's `provider` / `model` are updated to reflect the current attempt.
4. `OMEGA_AUTO_RETRY` defaults to `true`.
5. The UI surfaces retry state: a "↻ retried N×" badge on the task board, a "Retry" button + strategy dropdown on `TaskDetail`, and a "↻ retry (strategy, n/3)" line in the CLI `task watch` header when a retry is in flight.

## Non-goals

- Benchmark-suite retry path (covered separately; benchmark-task lifecycle is different).
- Webhook payload format changes (we add `notifyRetry` but it follows the existing `notifyFailure` shape).
- Retry-on-server-boot recovery of orphan `in_progress` tasks (currently marks them failed; that's a separate enhancement).
- Notification routing (paging on third retry) — keep it simple: one webhook per retry attempt, not per strategy.

## Design

### 1. Make the strategies return concrete model/provider values

`apps/server/src/lib/retry-strategies.ts`:

- **`clean-retry`** (unchanged): same `provider` / `model` as the original.
- **`tier-escalation`**: **internal (non-external) tasks only.** Uses the intelligent router's tier system at `packages/router/src/tiers.ts`. The strategy looks up the task's current tier and returns the next-up model from the provider currently selected. For external (codex) tasks, this strategy returns `undefined` — codex has no documented tier ladder, and we will not fabricate one. (Future: when the external-side tier ladder is documented in codex config, lift the `externalTag` guard.)
- **`different-provider`**: picks a different `ProviderConfig` row (excluding the current one) ordered by recent health score (`Router.health`), takes its `defaultModel`. Returns `{ strategy, provider, model }`. Also internal only — for external tasks, `different-cli` (below) is the analogous mechanism.
- **`orchestrated-fallback`** (unchanged structurally, but verified to actually pass through correctly — the existing `runOrchestratedTask(...)` call is correct, but the strategy itself only fires for non-external + non-orchestrate tasks).
- **`different-cli`** (unchanged): CLI rotation table for external CLIs. For the user's stated codex-verify-build hang failures, **this is the only strategy that materially helps** — it swaps codex for agy/claude-code/opencode which take a different code path. `clean-retry` and `tier-escalation` won't help if the hang is reproducible. The spec acknowledges this: retry here is "maybe try a different tool" rather than "guaranteed fix."

These two helpers are added:

```ts
async function nextInternalTier(prisma: PrismaClient, task: RetryContext['task']): Promise<{ provider: string; model: string } | null>;
async function pickDifferentProvider(prisma: PrismaClient, current: string | null): Promise<{ provider: string; model: string } | null>;
```

For external tasks, `tier-escalation`'s existing guard `if (externalTag) return undefined` (line 68) stays in place. The strategy effectively becomes a no-op for codex runs; for those, `different-cli` is the escalation path.

### 2. Make `executeRetry` honor `attempt.model` / `attempt.provider` / `attempt.effort`

Today (`retry-strategies.ts:160-183`) it ignores these fields entirely when calling the runner. Fix: since Section 3 will update `task.provider` + `task.model` BEFORE the retry runs (which is the path `executor.ts` already honors via `task.assignedModel`), `executeRetry` only needs to:

1. Pass `attempt.model` + `attempt.effort` to `runExternalAgentTask` (these are NOT on the task row — they're per-call run parameters).
2. For the internal / orchestrated paths, the task-row update from Section 3 is sufficient — `runAgentTask` / `runOrchestratedTask` already look at `task.assignedProvider` + `task.assignedModel`.

```ts
if (attempt.cli) {
  await runExternalAgentTask(prisma, taskId, {
    projectPath: options.projectPath,
    projectName: options.projectName,
    autoPublish: options.autoPublish,
    cli: attempt.cli,
    model: attempt.model,    // NEW: pass attempt.model
    effort: attempt.effort,  // NEW: pass attempt.effort
  });
} else if (attempt.strategy === 'orchestrated-fallback') {
  // unchanged — the orchestrator reads task.assignedModel after Section 3's update
} else {
  // unchanged — the agent task runner reads task.assignedProvider + task.assignedModel
  await runAgentTask(prisma, taskId, { ... }, router);
}
```

No `runAgentTask` signature change. The overrides flow through the existing task-row path.

### 3. Update the task row on retry

Per the Q-answer to "When a retry swaps model or provider, where do we record the active values?" — **update task row on retry**.

After `getNextStrategy` returns an attempt, BEFORE kicking off the retry, update the task row with the new provider/model (so `executor.ts`'s existing `task.assignedProvider` + `task.assignedModel` lookup honors the new values via the normal flow — no new overrides needed):

```ts
const taskUpdate: Record<string, unknown> = {};
if (attempt.provider) taskUpdate.provider = attempt.provider;
if (attempt.model) taskUpdate.model = attempt.model;
if (Object.keys(taskUpdate).length > 0) {
  await prisma.task.update({ where: { id: taskId }, data: taskUpdate });
}
```

**`retryCount` semantics — unchanged from existing code:** the increment happens AFTER the retry run, only if the task is still `failed`/`in_progress` (`retry-strategies.ts:202-211`). Keeping this preserves the `clean-retry` recovery path: if a task succeeded on retry-1 then is later re-run and fails, the second re-run triggers `clean-retry` again. If we incremented `retryCount` ahead of time, this case would skip `clean-retry` and fall through to `tier-escalation` immediately — a regression.

**`retryHistory` audit trail:** append the new attempt BEFORE the run, so even successful retries leave a record:

```ts
const task = await prisma.task.findUnique({ where: { id: taskId } });
if (task) {
  const existing = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
  existing.push({
    strategy: attempt.strategy,
    provider: attempt.provider,
    model: attempt.model,
    error: '',   // empty for "started"; populated below if the run fails
    timestamp: new Date().toISOString(),
  });
  await prisma.task.update({
    where: { id: taskId },
    data: { retryHistory: JSON.stringify(existing) },
  });
}
```

This is a small SPECIFICITY vs. the current code: the current code only appends AFTER the run (line 197-211) AND only when `isStillFailed`. The new behavior appends BEFORE the run and unconditionally — so even a successful retry-1 leaves a `clean-retry` record. The trailing `error: ''` gets overwritten with the actual error message in the catch block (existing behavior).

### 4. Flip `OMEGA_AUTO_RETRY` default to true

`apps/server/src/lib/run-task.ts` currently checks `process.env.OMEGA_AUTO_RETRY === 'true'`. Change the gate:

```ts
function autoRetryEnabled(): boolean {
  return (process.env.OMEGA_AUTO_RETRY ?? 'true').toLowerCase() !== 'false';
}
```

Default `'true'` means auto-retry is on unless explicitly disabled. Document in `.env.example` (at the **repo root**: `/Users/benebsworth/projects/omega/harness/.env.example`, not `apps/server/.env.example` — that file doesn't exist):

```sh
# Auto-retry on transient failures (default: true).
# Set to 'false' to disable auto-retry and require manual POST /tasks/:id/retry calls.
OMEGA_AUTO_RETRY=true
```

### 5. UI / UX

#### 5.1 CLI `task watch` retry line

`apps/cli/src/commands/task.ts`: 
- **Snapshot header (printed once on attach):** if `task.retryCount > 0`, parse `task.retryHistory` (JSON string) and print `↻ retried N× (last: <strategy>, <provider>/<model>)` after the standard task header.
- **Live retry detection:** track `lastTurn` in the closure of the watch's `onFrame`. When an `agent-run` event arrives with `currentTurn === 1 && lastTurn > 1`, print `↻ retry attempt N+1 starting on <provider>/<model>`. (This catches the case where a codex task's run completed, retry kicked off, and `currentTurn` reset from N→1 on the new run — the live SSE picks it up without needing a new event type.)

#### 5.2 Manual retry button + strategy dropdown

`apps/web/src/components/TaskDetail.tsx`: add a **Retry** button shown when `taskStatus === 'failed'`. Clicking opens a strategy picker (clean-retry / tier-escalation / different-provider / orchestrated-fallback / different-cli). Calling `POST /tasks/:id/retry { strategy: <name> }`.

`apps/web/src/lib/api.ts`: add `retryTask(id, strategy?)` returning `request<Task>(`/tasks/${id}/retry`, { method: 'POST', body: JSON.stringify({ strategy }) })`.

Export from `retry-strategies.ts`:
```ts
export const STRATEGIES_BY_NAME: Record<string, RetryStrategy> = Object.fromEntries(
  RETRY_STRATEGIES.map((s) => [s.name, s])
);
```

`apps/server/src/routes/tasks.ts` — `POST /:id/retry` (around line 343-393): already accepts the body, currently doesn't read `strategy`. Extend to read it. The route fetches the task, builds the `RetryContext`, then either calls the named strategy or `getNextStrategy(ctx)`:

```ts
const { strategy } = req.body ?? {};
const ctx: RetryContext = { task: ..., projectPath, projectName, error: task.error ?? '' };
let attempt: RetryAttempt | undefined;
if (strategy && STRATEGIES_BY_NAME[strategy]) {
  attempt = STRATEGIES_BY_NAME[strategy].apply(ctx);
} else {
  attempt = getNextStrategy(ctx);
}
if (!attempt) return res.status(409).json({ error: 'No retry strategy available' });
```

Add a new CLI command `harness task retry <id> [--strategy tier-escalation|...]`:
- `apps/cli/src/commands/task.ts` — `retry` subcommand alongside `run`/`orchestrate`/`watch`/`status`.
- Calls `api.runTask(id)` is wrong (wrong endpoint) — call `api.retryTask(id, opts.strategy)`.
- Append `apps/cli/src/api.ts` `retryTask(id, strategy?)`.

#### 5.3 "↻ retried N×" badge on TaskBoard

`apps/web/src/components/TaskBoard.tsx`: tasks with `retryCount > 0` show a small badge. Hover / focus reveals the `retryHistory` (compact list).

#### 5.4 Surface `retryCount` + `retryHistory` from API

The Prisma fields already exist on `Task` (Prisma serializes `retryHistory` as `string | null` because it's a JSON column). Add them to the `Task` type exported from `TaskBoard.tsx`:

```ts
retryCount: number;
retryHistory: string | null;  // JSON string from Prisma; consumers call safeJsonParse or similar
lastRetryAt: string | null;
```

The CLI parses `retryHistory` similarly (consumers deal with the JSON string themselves — no server-side parsed-and-re-serialized round-trip).

### 6. Webhook notification on retry

`apps/server/src/lib/webhook-alerts.ts`: add `notifyRetry(prisma, alert)` analogous to `notifyFailure` but with event `task.retry` + payload `{ task, attempt, retryCount }`. Called from `executeRetry` immediately before the rerun (NOT after, so the user is notified of the attempt and not just the outcome). Severity: `info`.

Define the alert type alongside the existing `FailureAlert`:

```ts
export interface RetryAlert {
  taskId: string;
  title: string;
  provider: string | null;
  model: string | null;
  strategy: string;
  retryCount: number;
  error: string;       // the prior failure's error
  tags: string[];      // includes 'retry' + the strategy name
  timestamp: string;
}

export async function notifyRetry(prisma: PrismaClient, alert: RetryAlert): Promise<void>;
```

This is *added*, not *moved* — `notifyFailure` on the inner retry exception stays as-is.

### 7. Tests

Two unit tests in `retry-strategies.test.ts` (new file at `apps/server/src/lib/retry-strategies.test.ts`):

1. `tier-escalation` returns a concrete model for an internal task with the current provider having `defaultModel = 'small'`. Mocked `providerConfig.findMany()` returns a provider with `defaultModel = 'small'` and a configured tier ladder. The strategy returns `{ strategy: 'tier-escalation', provider: <same>, model: <next-tier> }`.
2. `different-provider` returns a different `ProviderConfig` row than the current. Mocked `providerConfig.findMany()` returns two providers; the strategy excludes the current and returns the other.

Plus `pnpm --filter @omega/agent build` and `pnpm --filter @omega/server build` must exit 0 — confirming that `executor.ts` + `orchestrator.ts` (the callers of `runAgentTask` that I deliberately did NOT change) still typecheck and work. Their existing flow (`task.assignedProvider` / `task.assignedModel` lookup) handles the override automatically after Section 3's task row update.

Manual smoke (out of unit scope): launch a codex task on `gpt-5.6-luna`, fail it manually, observe `retryHistory` showing the `different-cli` attempt on `agy`.

## Data flow

**Internal (non-orchestrate) task, auto-retry triggered (verify-build hang on second run):**

```
1. Task run fails (e.g., verify-build hang).
2. run-task.ts catches + calls tryAutoRetry (now on by default).
3. tryAutoRetry fetches the task + calls getNextStrategy(ctx).
4. For retryCount === 0: clean-retry returns { strategy, provider, model } (current values).
5. Pre-run update: task.provider / task.model written to retry values; retryHistory prepended.
6. executeRetry calls runAgentTask (which reads task.assignedProvider + task.assignedModel — the new values).
7. notifyRetry webhook fires with the attempt.
8. On success: task.status = 'done'; retryHistory shows successful clean-retry.
9. On failure: retryCount increment AFTER the run if still failed.
```

**External (codex) task, auto-retry triggered:**

```
1. Codex run fails (verify-build hang).
2. tryAutoRetry → getNextStrategy(ctx).
3. clean-retry skipped (retryCount > 0 was the previous step, OR we're on a fresh task so clean-retry fires first).
4. tier-escalation: returns undefined (externalTask guard at retry-strategies.ts:68).
5. different-provider: returns undefined (externalTask guard at retry-strategies.ts:80).
6. orchestrated-fallback: returns undefined (externalTask guard).
7. different-cli: applies → returns { strategy: 'different-cli', cli: 'agy' } (rotation table).
8. executeRetry updates task row (cli tag rewritten to agy; provider model unchanged since CLI is the only thing that changed).
9. notifyRetry fires with cli=agy.
10. executeRetry calls runExternalAgentTask with cli=agy.
```

## Risks

- **Auto-retry default-on surprise**: users who expect a task to stop after one attempt will see retries. Mitigation: documentation in `.env.example`, webhook notification per retry, clear retry history on the task row + CLI.
- **`retryCount === MAX_RETRIES` cap**: still 3. If retryCount reaches 3 and a retry still fails, the task terminates as `failed`. No infinite loops.
- **`executor.ts` not changed**: the existing `task.assignedProvider` / `task.assignedModel` lookup pattern is the path that the Section 3 task-row update flows through. No new exports, no new overrides, no new test surface for the executor.
- **Tier-escalation gap for codex**: external codex has no documented tier ladder, so `tier-escalation` returns `undefined` for `external:*` tasks. For the user's stated codex-verify-build hang pain, the effective retry mechanism is `different-cli` (codex → agy). This is documented; not a bug but a real limitation.
- **Race between `tryAutoRetry` and `POST /:id/retry`**: if a user manually retries while auto-retry is also firing, the second execution re-fetches the task and uses the new `retryCount` — but a race window exists where both calls dispatch. The existing `executeRetry` (line 197-211) re-fetches the task and builds retryHistory from current state, so the audit trail is correct. Worst case: a double-fire producing two `retryHistory` entries for one intentional retry. Mitigation: the next pass could add a `prisma.task.update ... where: { retryCount: { equals: prevRetryCount } }` optimistic concurrency check to make executeRetry idempotent. Out of scope for this change.
- **Auto-retry disabled by users who depend on the old default**: the previous default was `false` (you had to set `OMEGA_AUTO_RETRY=true`). Flipping it to `true` is a behavior change. Mitigation: documented in `.env.example` + commit message.

## Files touched

- `apps/server/src/lib/retry-strategies.ts` — wire `tier-escalation` + `different-provider` for internal tasks; fix `executeRetry` to pass `attempt.model`/`effort` to `runExternalAgentTask` + write the pre-run audit; export `STRATEGIES_BY_NAME`.
- `apps/server/src/routes/tasks.ts` — `POST /:id/retry` reads `strategy`, builds `RetryContext`, dispatches to the named strategy or `getNextStrategy`.
- `apps/server/src/lib/webhook-alerts.ts` — `notifyRetry` + `RetryAlert`.
- `apps/server/src/lib/run-task.ts` — flip `OMEGA_AUTO_RETRY` default to `'true'` via the helper function.
- `.env.example` — document `OMEGA_AUTO_RETRY=true`.
- `apps/cli/src/commands/task.ts` — surface retry line in `task watch` (snapshot + live `currentTurn` reset detection); add `task retry <id> [--strategy ...]` subcommand.
- `apps/cli/src/api.ts` — add `retryTask(id, strategy?)`.
- `apps/web/src/components/TaskDetail.tsx` — Retry button + strategy picker on failed tasks.
- `apps/web/src/components/TaskBoard.tsx` — `↻ N×` badge on tasks with `retryCount > 0`; expand the `Task` interface to include `retryCount`/`lastRetryAt`/`retryHistory` (as a JSON string parsed at consumer).
- `apps/web/src/lib/api.ts` — `retryTask(id, strategy?)` calling `POST /tasks/:id/retry`.
- `apps/server/src/lib/retry-strategies.test.ts` — new file, 2 unit tests.

11 files. ~250-350 LOC total.

## Acceptance criteria

1. `retry-strategies.test.ts` passes: `tier-escalation` returns a concrete model; `different-provider` returns a different provider.
2. `executeRetry` passes `attempt.model` + `attempt.effort` to `runExternalAgentTask`.
3. After a retry, `GET /tasks/:id` returns the new `provider` / `model` (driven by Section 3's task-row update).
4. `OMEGA_AUTO_RETRY` defaults to `'true'`; documented in `.env.example`.
5. `POST /tasks/:id/retry { strategy: 'tier-escalation' }` runs the named strategy (not auto-selected).
6. CLI `harness task watch <id>` prints `↻ retried N× (last: <strategy>, <provider>/<model>)` header when `retryCount > 0`.
7. CLI `harness task watch <id>` prints a live `↻ retry attempt N+1 starting on <provider>/<model>` when `currentTurn` resets (1 after a higher number).
8. CLI `harness task retry <id> --strategy tier-escalation` triggers an explicit named retry.
9. Web `TaskDetail` shows a Retry button on failed tasks with a strategy picker.
10. Web `TaskBoard` shows a `↻ N×` badge on tasks with `retryCount > 0` (hover reveals retry history).
11. Webhook `task.retry` fires per attempt with payload including `strategy`, `retryCount`, `provider`, `model`.
12. Build clean: `pnpm --filter @omega/server build && pnpm --filter @omega/cli build && pnpm --filter @omega/web build && pnpm --filter @omega/agent build` all exit 0. Agent unit tests pass (existing 14 stay green).
13. Manual smoke: launch a codex task on `gpt-5.6-luna`, simulate failure (e.g., via an unreachable verify command), confirm `retryHistory` shows one `different-cli` attempt (codex → agy), and the task row's tags reflect the CLI swap.
