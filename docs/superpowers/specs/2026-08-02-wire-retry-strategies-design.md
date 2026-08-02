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
- **`tier-escalation`**: needs a model escalation ladder. For external codex, the ladder is `{ 'gpt-5.6-luna': 'gpt-5.6', 'gpt-5.6': 'gpt-5.6-large' }` (placeholder; real ladder lives in codex config — codex itself rejects unknown models). For internal (non-external) tasks, the ladder is provided by the intelligent router (`router.tiers.ts`). On retry the strategy returns the next-up model.
- **`different-provider`**: picks a different `ProviderConfig` row (excluding the current one) ordered by recent health score, takes its `defaultModel`. Returns `{ strategy, provider, model }`.
- **`orchestrated-fallback`** (unchanged structurally, but verified to actually pass through correctly — the existing `runOrchestratedTask(...)` call is correct, but the strategy itself only fires for non-external + non-orchestrate tasks).
- **`different-cli`** (unchanged): CLI rotation table for external CLIs.

These two helpers are added:

```ts
async function nextCodexTier(currentModel: string | null): Promise<string | null>;
async function pickDifferentProvider(prisma: PrismaClient, current: string | null): Promise<{ provider: string; model: string } | null>;
```

### 2. Make `executeRetry` honor `attempt.model` / `attempt.provider` / `attempt.effort`

Today (`retry-strategies.ts:160-183`) it ignores these fields entirely when calling the runner. Fix:

```ts
if (attempt.cli) {
  await runExternalAgentTask(prisma, taskId, {
    projectPath: options.projectPath,
    projectName: options.projectName,
    autoPublish: options.autoPublish,
    cli: attempt.cli,
    model: attempt.model,
    effort: attempt.effort,
  });
} else if (attempt.strategy === 'orchestrated-fallback') {
  // unchanged
} else {
  // attempt.provider set: skip the router entirely; let the runner use it
  // attempt.provider NOT set: re-ask the router with the new model hint
  await runAgentTask(prisma, taskId, { ... }, router, {
    providerOverride: attempt.provider,
    modelOverride: attempt.model,
  });
}
```

`runAgentTask` gains two optional fields (`providerOverride`, `modelOverride`) — when `providerOverride` is set, the router is skipped and we pass straight through. Falls back to router selection when only `modelOverride` is set.

### 3. Update the task row on retry

Per the Q-answer to "When a retry swaps model or provider, where do we record the active values?" — **update task row on retry**.

After `getNextStrategy` returns an attempt, update the task row before kicking off the retry:

```ts
const taskUpdate: Record<string, unknown> = { retryCount: { increment: 1 } };
if (attempt.provider) taskUpdate.provider = attempt.provider;
if (attempt.model) taskUpdate.model = attempt.model;
if (attempt.cli) {
  // replace the existing external:<cli> tag (already in the task tags JSON)
  // but keep all other tags. The `tags` column is a JSON string.
}
await prisma.task.update({ where: { id: taskId }, data: taskUpdate });
```

Then run the retry.

The existing `retryHistory` field (JSON column, already in the schema) gets the new attempt appended — already happens at lines 197-211 but currently only when `isStillFailed`. Move the append to happen BEFORE the run, regardless of subsequent outcome, so we have an audit trail even on success.

### 4. Flip `OMEGA_AUTO_RETRY` default to true

`retry-strategies.ts:46`:
```ts
const MAX_RETRIES = envInt('OMEGA_MAX_RETRIES', 3);  // unchanged
```
But also add a new env var `OMEGA_AUTO_RETRY` default. Currently the check is:
```ts
if (options.detached) ...
if (process.env.OMEGA_AUTO_RETRY === 'true') await tryAutoRetry(prisma, taskId, ...);
```
Change the default to `OMEGA_AUTO_RETRY` defaulting to `'true'`. Update `.env.example` with documentation.

### 5. UI / UX

#### 5.1 CLI `task watch` retry line

`apps/cli/src/commands/task.ts`: in the snapshot header (printed once on attach), if `retryCount > 0`, print a `↻ retried N× (last: <strategy>)` line using `task.retryHistory`. In the live `agent-run` handler, if the new attempt's `currentTurn === 1` after a transition, print `↻ retry attempt starting on <provider>/<model>`.

#### 5.2 Manual retry button + strategy dropdown

`apps/web/src/components/TaskDetail.tsx`: add a **Retry** button shown when `taskStatus === 'failed'`. Clicking opens a strategy picker (clean-retry / tier-escalation / different-provider / orchestrated-fallback). Calling `POST /tasks/:id/retry { strategy: <name> }`.

`apps/web/src/lib/api.ts`: add `retryTask(id, strategy?)` returning `request<Task>(`/tasks/${id}/retry`, { method: 'POST', body: JSON.stringify({ strategy }) })`.

`apps/server/src/routes/tasks.ts` — `POST /:id/retry` (line ~343-393): already accepts the body, currently doesn't read `strategy`. Extend to read it:

```ts
const { strategy } = req.body ?? {};
const attempt = strategy
  ? SPECIFIC_STRATEGY_BY_NAME[strategy]?.apply(ctx)
  : getNextStrategy(ctx);
if (!attempt) return res.status(409).json({ error: 'No retry strategy available' });
```

Export a `STRATEGIES_BY_NAME` map from `retry-strategies.ts` for the route to use.

#### 5.3 "↻ retried N×" badge on TaskBoard

`apps/web/src/components/TaskBoard.tsx`: tasks with `retryCount > 0` show a small badge. Hover / focus reveals the `retryHistory` (compact list).

#### 5.4 Surface `retryCount` + `retryHistory` from API

The Prisma fields already exist on `Task`. Add them to the `Task` type exported from `TaskBoard.tsx`:

```ts
retryCount: number;
retryHistory: string | null;  // JSON string, parsed at consumer
lastRetryAt: string | null;
```

### 6. Webhook notification on retry

`apps/server/src/lib/webhook-alerts.ts`: add `notifyRetry(prisma, alert)` analogous to `notifyFailure` but with event `task.retry` + payload `{ task, attempt, retryCount }`. Called from `executeRetry` immediately before the rerun (NOT after, so the user is notified of the attempt and not just the outcome). Severity: `info`.

This is *added*, not *moved* — `notifyFailure` on the inner retry exception stays as-is.

### 7. Tests

Two unit tests in `retry-strategies.test.ts` (new file):

1. `tier-escalation` returns the next-up model for codex (`gpt-5.6-luna` → `gpt-5.6`).
2. `different-provider` returns a different `ProviderConfig` row than the current.

Manual smoke: launch a codex task with a low-tier model on an intentionally tiny description; verify the retry-history shows up after a 2nd-attempt attempt.

## Data flow

```
1. Task fails (e.g., verify-build hang).
2. run-task.ts catches + calls tryAutoRetry (now on by default).
3. tryAutoRetry fetches the task + calls getNextStrategy(ctx).
4. tier-escalation → returns { strategy, model: 'gpt-5.6' } (one tier up).
5. executeRetry updates task row (retryCount++, provider/model, retryHistory).
6. executeRetry calls runExternalAgentTask with the new model.
7. notifyRetry webhook fires with the attempt.
8. On success: task.status = 'done', model now reflects what actually ran.
9. On failure: retryCount > 3 → give up, status = 'failed', retryHistory preserved.
```

## Risks

- **Auto-retry default-on surprise**: users who expect a task to stop after one attempt will see retries. Mitigation: documentation in `.env.example`, webhook notification per retry, clear retry history on the task row + CLI.
- **`runAgentTask` signature change**: adding optional `providerOverride`/`modelOverride` doesn't break the call sites (all fields remain optional). One internal call site is updated. Other callers (`run-task.ts`) keep working.
- **Tier-escalation ladder is codex-specific**: hard-coded at first. Future-proofing is out of scope; documented as a future enhancement.

## Files touched

- `apps/server/src/lib/retry-strategies.ts` — strategy wirings + executeRetry fix + provider switch logic.
- `apps/server/src/routes/tasks.ts` — `POST /:id/retry` reads `strategy`.
- `apps/server/src/lib/webhook-alerts.ts` — `notifyRetry`.
- `apps/server/src/lib/run-task.ts` — pass through overrides if needed.
- `packages/agent/src/agent-loop.ts` or wherever `runAgentTask` lives — accept overrides.
- `packages/agent/src/external.ts` — accept model override on the runner (already accepts it; just verify).
- `apps/cli/src/commands/task.ts` — surface retry line + manual retry command.
- `apps/cli/src/commands/cli.ts` — possibly add `harness task retry <id>` command.
- `apps/web/src/components/TaskDetail.tsx` — Retry button + strategy picker.
- `apps/web/src/components/TaskBoard.tsx` — retry badge.
- `apps/web/src/components/ProjectSidebar.tsx` — possibly nothing (no new sidebar view).
- `apps/web/src/lib/api.ts` — `retryTask(id, strategy?)`.
- `apps/server/.env.example` (or `.env.example`) — document `OMEGA_AUTO_RETRY=true` default.
- `packages/agent/src/lib/run-task.ts` (or wherever the providerOverride flows) — pass-through.
- `apps/server/src/lib/retry-strategies.test.ts` — new file, ~80 LOC, 2-3 tests.

~12-14 files, ~250-400 LOC total.

## Acceptance criteria

1. `retry-strategies.test.ts` passes; `tier-escalation` returns a concrete model; `different-provider` returns a different provider.
2. `executeRetry` passes `attempt.model` / `attempt.effort` to `runExternalAgentTask`; passes `providerOverride` to `runAgentTask` when set.
3. After a retry, `GET /tasks/:id` returns the new `provider` / `model`.
4. `OMEGA_AUTO_RETRY` defaults to `'true'`; documented in `.env.example`.
5. `POST /tasks/:id/retry { strategy: 'tier-escalation' }` runs the specific strategy (not auto-selected).
6. CLI `harness task watch <id>` prints the `↻ retried N× (last: <strategy>)` header when applicable.
7. CLI `harness task retry <id> --strategy tier-escalation` triggers an explicit retry.
8. Web `TaskDetail` shows a Retry button on failed tasks with a strategy picker.
9. Web `TaskBoard` shows a `↻ N×` badge on tasks with `retryCount > 0`.
10. Webhook `task.retry` fires per attempt.
11. Build clean (`pnpm --filter @omega/server build && pnpm --filter @omega/cli build && pnpm --filter @omega/web build`); agent + server tests pass.
12. Manual smoke test: launch a codex task on `gpt-5.6-luna`, simulate failure (e.g., via an unreachable verify command in a controlled test project), observe retry-history with one tier-escalation attempt.
