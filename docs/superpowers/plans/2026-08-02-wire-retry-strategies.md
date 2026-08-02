# Wire Retry Strategies Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retry actually work end-to-end — wire the unwired strategies, fix `executeRetry` to honor attempt values, persist the active provider/model on the task row on retry, flip `OMEGA_AUTO_RETRY` default-on, and surface retry state across CLI + web UI + webhook notifications.

**Architecture:** Server-only mechanism changes (retry-strategies.ts, executeRetry, run-task default-on, notifyRetry), one route (POST /:id/retry reads strategy), one CLI surface (task retry + watch header), and a web UI surface (Retry button + strategy picker + retry badge). No new schema columns — Task.retryCount / retryHistory / lastRetryAt already exist.

**Tech Stack:** TypeScript, Express + Prisma + PGlite, React + Vite + SWR, Vitest, Commander.

**Spec:** `docs/superpowers/specs/2026-08-02-wire-retry-strategies-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/server/src/lib/retry-strategies.ts` | Modify | Wire `tier-escalation` + `different-provider` for internal tasks; fix `executeRetry` to pass `attempt.model`/`effort` to `runExternalAgentTask` + write pre-run audit; export `STRATEGIES_BY_NAME`; add `nextInternalTier` + `pickDifferentProvider` helpers. |
| `apps/server/src/lib/retry-strategies.test.ts` | Create | 2 unit tests (tier-escalation + different-provider). |
| `apps/server/src/lib/run-task.ts` | Modify | Flip `OMEGA_AUTO_RETRY` default-on. |
| `apps/server/src/lib/webhook-alerts.ts` | Modify | Add `notifyRetry` + `RetryAlert` type. |
| `apps/server/src/routes/tasks.ts` | Modify | `POST /:id/retry` reads `strategy` body. |
| `apps/cli/src/api.ts` | Modify | Add `retryTask(id, strategy?)`. |
| `apps/cli/src/commands/task.ts` | Modify | Add `task retry <id> [--strategy]` subcommand; surface retry line in `task watch` snapshot + live. |
| `.env.example` | Modify | Document `OMEGA_AUTO_RETRY=true` default. |
| `apps/web/src/components/TaskDetail.tsx` | Modify | Retry button + strategy picker on failed tasks. |
| `apps/web/src/components/TaskBoard.tsx` | Modify | `↻ N×` retry badge on tasks with `retryCount > 0`; expand `Task` interface to include `retryCount`/`retryHistory`/`lastRetryAt`. |
| `apps/web/src/lib/api.ts` | Modify | Add `retryTask(id, strategy?)`. |

No new files beyond the test file. No schema migrations.

---

## Chunk 1: Server Side — Strategies + ExecuteRetry + Run-Task Default-On + Webhook

### Task 1.1: Wire `tier-escalation` and `different-provider` for internal tasks + add the helper functions

**Files:**
- Modify: `apps/server/src/lib/retry-strategies.ts:48-86` (the two strategies)
- Modify: `apps/server/src/lib/retry-strategies.ts` (add helpers above the `RETRY_STRATEGIES` array)

- [ ] **Step 1: Add the two helper functions above the `RETRY_STRATEGIES` array (line 48)**

In `apps/server/src/lib/retry-strategies.ts`, immediately before `const RETRY_STRATEGIES: RetryStrategy[] = [`, add:

```ts
async function nextInternalTier(
  prisma: PrismaClient,
  ctx: RetryContext,
): Promise<{ provider: string; model: string } | null> {
  if (!ctx.task.provider || !ctx.task.model) return null;
  const provider = await prisma.providerConfig.findUnique({
    where: { kind: ctx.task.provider },
  });
  if (!provider) return null;
  // ProviderConfig.capabilities is a JSON column. If a tier ladder is configured,
  // it lives there as `{ modelTiers: { [currentModel]: nextModel } }`.
  const caps = provider.capabilities as { modelTiers?: Record<string, string> } | null;
  const ladder = caps?.modelTiers;
  if (ladder && ladder[ctx.task.model]) {
    const nextModel = ladder[ctx.task.model];
    if (nextModel) return { provider: ctx.task.provider, model: nextModel };
  }
  return null;
}

async function pickDifferentProvider(
  prisma: PrismaClient,
  current: string | null,
): Promise<{ provider: string; model: string } | null> {
  const candidates = await prisma.providerConfig.findMany({
    where: {
      enabled: true,
      ...(current ? { kind: { not: current } } : {}),
    },
    take: 5,
  });
  if (candidates.length === 0) return null;
  const pick = candidates[0];
  if (!pick) return null;
  return { provider: pick.kind, model: pick.defaultModel };
}
```

These helpers are used by the rewired strategies in Step 2.

- [ ] **Step 2: Rewire `tier-escalation` and `different-provider` strategies**

Replace the `tier-escalation` block (lines 61-73) with:

```ts
  {
    name: 'tier-escalation',
    description: 'Escalate to a higher model tier (internal tasks only)',
    apply: async (ctx) => {
      if (ctx.task.retryCount > 1) return undefined;
      const tags = ctx.task.tags;
      if (tags.find((t) => t.startsWith('external:'))) return undefined;
      if (tags.includes('orchestrate')) return undefined;
      const next = await nextInternalTier(prisma, ctx);
      if (!next) return undefined;
      return { strategy: 'tier-escalation', provider: next.provider, model: next.model };
    },
  },
```

Replace `different-provider` (lines 74-86) similarly:

```ts
  {
    name: 'different-provider',
    description: 'Swap to a different provider (internal tasks only)',
    apply: async (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      if (tags.find((t) => t.startsWith('external:'))) return undefined;
      if (tags.includes('orchestrate')) return undefined;
      const next = await pickDifferentProvider(prisma, ctx.task.provider);
      if (!next) return undefined;
      return { strategy: 'different-provider', provider: next.provider, model: next.model };
    },
  },
```

- [ ] **Step 3: Update the `RetryStrategy.apply` interface to accept async**

At line 6-10, change:
```ts
export interface RetryStrategy {
  name: string;
  description: string;
  apply: (ctx: RetryContext) => RetryAttempt | undefined;
}
```
to:
```ts
export interface RetryStrategy {
  name: string;
  description: string;
  apply: (ctx: RetryContext) => RetryAttempt | undefined | Promise<RetryAttempt | undefined>;
}
```

And update `getNextStrategy` (lines 126-133) to await:
```ts
export async function getNextStrategy(ctx: RetryContext): Promise<RetryAttempt | undefined> {
  if (ctx.task.retryCount >= MAX_RETRIES) return undefined;
  for (const strategy of RETRY_STRATEGIES) {
    const attempt = await strategy.apply(ctx);
    if (attempt) return attempt;
  }
  return undefined;
}
```

The call sites of `getNextStrategy` (currently in `apps/server/src/routes/tasks.ts:374` and the auto-retry path in `run-task.ts`) need to be updated to `await getNextStrategy(...)`.

- [ ] **Step 4: Skip the build verification here — Task 1.2 adds the call sites that `getNextStrategy` becoming async requires.**

- [ ] **Step 5: No commit — continue to Task 1.2.**

### Task 1.2: Update `executeRetry` — pass `attempt.model` + `attempt.effort` to `runExternalAgentTask`, add pre-run task row update, append `retryHistory` before run, export `STRATEGIES_BY_NAME`

**Files:**
- Modify: `apps/server/src/lib/retry-strategies.ts:135-220` (the `executeRetry` function)

- [ ] **Step 1: Replace the body of `executeRetry` (lines 135-220) with the pre-run + audit + passed-through model/effort version**

Replace the entire `executeRetry` function body:

```ts
export async function executeRetry(
  prisma: PrismaClient,
  taskId: string,
  attempt: RetryAttempt,
  options: { projectPath: string; projectName: string; autoPublish: boolean },
): Promise<void> {
  // 1. Pre-run task row update: persist the active provider/model on the task row.
  //    This is the path that executor.ts / orchestrator.ts already honor via
  //    task.assignedModel (a { provider, model } record).
  const taskUpdate: Record<string, unknown> = {};
  if (attempt.provider) taskUpdate.provider = attempt.provider;
  if (attempt.model) taskUpdate.model = attempt.model;
  if (Object.keys(taskUpdate).length > 0) {
    await prisma.task.update({ where: { id: taskId }, data: taskUpdate });
  }

  // 2. Pre-run audit: append to retryHistory BEFORE the run so successful retries leave a record.
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (task) {
    const existing = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
    const record: RetryRecord = {
      strategy: attempt.strategy,
      provider: attempt.provider,
      model: attempt.model,
      error: '', // populated on failure below
      timestamp: new Date().toISOString(),
    };
    existing.push(record);
    await prisma.task.update({
      where: { id: taskId },
      data: { retryHistory: JSON.stringify(existing) },
    });
  }

  // 3. Run the retry.
  try {
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
      const { runOrchestratedTask } = await import('@omega/agent');
      const { getRouter } = await import('./intelligent-router.js');
      const router = await getRouter(prisma);
      await runOrchestratedTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
        intelligentRouter: router,
      });
    } else {
      // internal task — task row already updated with provider/model; the runner honors it.
      const { runAgentTask } = await import('@omega/agent');
      const { getRouter } = await import('./intelligent-router.js');
      const router = await getRouter(prisma);
      await runAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
      }, router);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const provider = attempt.provider ?? attempt.cli ?? null;
    void notifyFailure(prisma, {
      taskId,
      title: task?.title ?? '',
      provider,
      model: attempt.model ?? null,
      error: message,
      tags: ['retry', attempt.strategy],
      timestamp: new Date().toISOString(),
    });
  }

  // 4. After the run: keep the existing retryCount + lastRetryAt + retryHistory update behavior.
  const after = await prisma.task.findUnique({ where: { id: taskId } });
  if (!after) return;
  const existing = safeJsonParse<RetryRecord[]>(after.retryHistory, []);
  // Update the latest record with the actual error if any
  const lastRecord = existing[existing.length - 1];
  if (lastRecord && lastRecord.error === '') {
    lastRecord.error = after.error ?? '';
  }
  const isStillFailed = after.status === 'failed' || after.status === 'in_progress';
  await prisma.task.update({
    where: { id: taskId },
    data: {
      retryCount: isStillFailed ? { increment: 1 } : undefined,
      lastRetryAt: new Date(),
      retryHistory: JSON.stringify(existing),
    },
  });

  console.log('Retry executed', {
    taskId,
    strategy: attempt.strategy,
    retryCount: after.retryCount + 1,
    error: after.error || undefined,
  });
}
```

- [ ] **Step 2: Export `STRATEGIES_BY_NAME` after `RETRY_STRATEGIES` is declared**

Add right after the `RETRY_STRATEGIES` array (line 124):

```ts
export const STRATEGIES_BY_NAME: Record<string, RetryStrategy> = Object.fromEntries(
  RETRY_STRATEGIES.map((s) => [s.name, s]),
);
```

- [ ] **Step 3: Update `getNextStrategy` call sites to await**

In `apps/server/src/routes/tasks.ts:374` (within the `POST /:id/retry` handler), change `const attempt = getNextStrategy(ctx);` to `const attempt = await getNextStrategy(ctx);`.

In `apps/server/src/lib/run-task.ts`, find the `tryAutoRetry` function (it calls `getNextStrategy`). Add `await`:

Search for `getNextStrategy` in `apps/server/src/lib/run-task.ts` and add `await`.

- [ ] **Step 4: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/server build 2>&1 | tail -5`
Expected: exit 0.

(If pnpm hangs due to this session's intermittent subprocess-spawn quirk, fall back to `timeout 180 node node_modules/typescript/bin/tsc -p apps/server 2>&1 | tail -5`.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/retry-strategies.ts apps/server/src/routes/tasks.ts apps/server/src/lib/run-task.ts
git commit -m "feat(server): wire retry strategies + pre-run task row update"
```

### Task 1.3: Flip `OMEGA_AUTO_RETRY` default to `'true'`

**Files:**
- Modify: `apps/server/src/lib/run-task.ts:16` (the current `if (process.env.OMEGA_AUTO_RETRY !== 'true') return;`)
- Modify: `.env.example` (repo root)

- [ ] **Step 1: Replace the env check with a helper that defaults to `'true'`**

In `apps/server/src/lib/run-task.ts`, replace line 16:

```ts
  if (process.env.OMEGA_AUTO_RETRY !== 'true') return;
```

with:

```ts
  if ((process.env.OMEGA_AUTO_RETRY ?? 'true').toLowerCase() === 'false') return;
```

Defaults to `'true'` — auto-retry is on unless explicitly disabled.

- [ ] **Step 2: Document the default in `.env.example`**

In `/Users/benebsworth/projects/omega/harness/.env.example`, find an appropriate section (likely near other `OMEGA_*` vars). Add:

```sh
# Auto-retry on transient failures (default: true).
# Set to 'false' to disable auto-retry; manual POST /tasks/:id/retry still works.
OMEGA_AUTO_RETRY=true
```

If no `OMEGA_*` section exists, append to the end.

- [ ] **Step 3: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/server build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/lib/run-task.ts .env.example
git commit -m "feat(server): flip OMEGA_AUTO_RETRY default to true + document in .env.example"
```

### Task 1.4: Add `notifyRetry` + `RetryAlert` to webhook-alerts.ts

**Files:**
- Modify: `apps/server/src/lib/webhook-alerts.ts` (after `FailureAlert`)
- Modify: `apps/server/src/lib/retry-strategies.ts` (call `notifyRetry` from `executeRetry`)

- [ ] **Step 1: Add the `RetryAlert` type and `notifyRetry` function**

In `apps/server/src/lib/webhook-alerts.ts`, immediately after the existing `FailureAlert` interface (around line 19), add:

```ts
export interface RetryAlert {
  taskId: string;
  title: string;
  provider: string | null;
  model: string | null;
  strategy: string;
  retryCount: number;
  previousError: string;
  tags: string[];
  timestamp: string;
}
```

Then, immediately after the existing `notifyFailure` function (line 146), add a thin wrapper that uses the existing `postWebhook` helper (which already handles URL enumeration, `!res.ok` checks, and the 10s timeout — see line ~132). Match the **`notifyFailure` shape**: severity + nested `task: {...}` + `timestamp`, so webhook consumers see a consistent shape across events:

```ts
export async function notifyRetry(prisma: PrismaClient, alert: RetryAlert): Promise<void> {
  void prisma; // reserved for future per-task routing
  await postWebhook('task.retry', {
    severity: 'info',
    task: {
      id: alert.taskId,
      title: alert.title,
      provider: alert.provider,
      model: alert.model,
      strategy: alert.strategy,
      retryCount: alert.retryCount,
      previousError: alert.previousError,
      tags: alert.tags,
    },
    timestamp: alert.timestamp,
  });
}
```

Read `apps/server/src/lib/webhook-alerts.ts` to confirm the `postWebhook(event, payload)` signature matches and `notifyFailure`'s nested-`task` shape.

- [ ] **Step 2: Call `notifyRetry` from `executeRetry`**

In `apps/server/src/lib/retry-strategies.ts`, inside `executeRetry` (Task 1.2's replacement), BEFORE the `try { ... }` block that runs the retry, add:

```ts
  // Webhook: notify that a retry is starting (NOT after, so the user is informed of the attempt).
  void notifyRetry(prisma, {
    taskId,
    title: task?.title ?? '',
    provider: attempt.provider ?? attempt.cli ?? null,
    model: attempt.model ?? null,
    strategy: attempt.strategy,
    retryCount: (task?.retryCount ?? 0) + 1,
    previousError: task?.error ?? '',
    tags: ['retry', attempt.strategy],
    timestamp: new Date().toISOString(),
  });
```

Add `import { notifyFailure, notifyRetry }` from `./webhook-alerts.js` (it currently imports only `notifyFailure`).

- [ ] **Step 3: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/server build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/lib/webhook-alerts.ts apps/server/src/lib/retry-strategies.ts
git commit -m "feat(server): notifyRetry webhook on each retry attempt"
```

### Task 1.5: Unit tests — `tier-escalation` + `different-provider`

**Files:**
- Create: `apps/server/src/lib/retry-strategies.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/server/src/lib/retry-strategies.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@omega/db';
import { getNextStrategy, type RetryContext } from './retry-strategies.js';

function makePrismaMock(opts: {
  providers?: Array<{ kind: string; enabled: boolean; defaultModel: string; capabilities: unknown }>;
}): PrismaClient {
  return {
    providerConfig: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { kind: string } }) => {
        return opts.providers?.find((p) => p.kind === where.kind) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where?: { enabled?: boolean; kind?: { not?: string } } }) => {
        let result = opts.providers ?? [];
        if (where?.enabled === true) result = result.filter((p) => p.enabled);
        if (where?.kind?.not) result = result.filter((p) => p.kind !== where.kind.not);
        return result;
      }),
    },
  } as unknown as PrismaClient;
}

function makeCtx(overrides: Partial<RetryContext['task']> = {}): RetryContext {
  return {
    task: {
      id: 'task-1',
      projectId: 'proj-1',
      title: 'Test',
      description: null,
      complexity: 'simple',
      tags: [],
      provider: 'qwen',
      model: 'qwen-small',
      retryCount: 1,
      retryHistory: [],
      ...overrides,
    },
    projectPath: '/tmp',
    projectName: 'project',
    error: 'build timed out',
  };
}

describe('getNextStrategy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tier-escalation returns a concrete model from the configured ladder', async () => {
    const prisma = makePrismaMock({
      providers: [
        {
          kind: 'qwen',
          enabled: true,
          defaultModel: 'qwen-small',
          capabilities: { modelTiers: { 'qwen-small': 'qwen-large' } },
        },
      ],
    });
    const ctx = makeCtx({ retryCount: 1, provider: 'qwen', model: 'qwen-small' });
    const attempt = await getNextStrategy(ctx);
    expect(attempt).toBeDefined();
    expect(attempt?.strategy).toBe('tier-escalation');
    expect(attempt?.provider).toBe('qwen');
    expect(attempt?.model).toBe('qwen-large');
  });

  it('different-provider returns a different ProviderConfig row', async () => {
    const prisma = makePrismaMock({
      providers: [
        { kind: 'qwen', enabled: true, defaultModel: 'qwen-large', capabilities: {} },
        { kind: 'deepseek', enabled: true, defaultModel: 'deepseek-default', capabilities: {} },
        { kind: 'kimi', enabled: true, defaultModel: 'kimi-default', capabilities: {} },
      ],
    });
    const ctx = makeCtx({ provider: 'qwen', model: 'qwen-large', retryCount: 1 });
    const attempt = await getNextStrategy(ctx);
    expect(attempt).toBeDefined();
    expect(attempt?.strategy).toBe('different-provider');
    expect(attempt?.provider).not.toBe('qwen');
    expect(['deepseek', 'kimi']).toContain(attempt?.provider);
    expect(attempt?.model).toMatch(/default$/);
  });
});
```

- [ ] **Step 2: Verify the tests pass**

Run: `timeout 90 pnpm --filter @omega/server test 2>&1 | tail -15`
Expected: exit 0, both tests pass.

(If pnpm hangs, fall back to `timeout 120 node node_modules/vitest/vitest.mjs run --root apps/server 2>&1 | tail -15`.)

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/lib/retry-strategies.test.ts
git commit -m "test(server): unit tests for tier-escalation + different-provider strategies"
```

### Task 1.6: Extend `POST /tasks/:id/retry` to read `strategy` from the body

**Files:**
- Modify: `apps/server/src/routes/tasks.ts:343-393` (the `POST /:id/retry` handler)
- Modify: `apps/server/src/lib/retry-strategies.ts` (add `STRATEGIES_BY_NAME` to the public exports — already done in Task 1.2)

- [ ] **Step 1: Update imports + accept `strategy` from the body**

In `apps/server/src/routes/tasks.ts`, near the top of the file, update the `retry-strategies.js` import to also pull `STRATEGIES_BY_NAME`:

```ts
import { getNextStrategy, STRATEGIES_BY_NAME, type RetryAttempt, type RetryContext, type RetryRecord } from '../lib/retry-strategies.js';
```

(Add `STRATEGIES_BY_NAME` to whatever import line already exists. If the current import only pulls `getNextStrategy` etc., extend it.)

- [ ] **Step 2: Read `strategy` body + dispatch to named strategy**

In the `POST /:id/retry` handler (around line 343-393), after the `RetryContext` is built (after line 366 ish — `const ctx: RetryContext = { ... }`), replace the line that currently runs `const attempt = getNextStrategy(ctx);` (line 374) with this dispatch:

```ts
    const { strategy: strategyName } = req.body ?? {};
    let attempt: RetryAttempt | undefined;
    if (typeof strategyName === 'string' && STRATEGIES_BY_NAME[strategyName]) {
      attempt = await STRATEGIES_BY_NAME[strategyName].apply(ctx);
    } else {
      attempt = await getNextStrategy(ctx);
    }
```

If `strategyName` is provided but not a valid strategy, fall through to `getNextStrategy(ctx)` for the default behavior. The original `if (!attempt)` 400 response stays unchanged.

- [ ] **Step 3: Update the response to include `strategy`**

The current response shape is `{ status, strategy, retryCount }` (line 391). With the new dispatch, `attempt.strategy` is the strategy that was run — keep this line but ensure `strategy` is always populated (it already is via `attempt.strategy`).

- [ ] **Step 4: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/server build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/tasks.ts
git commit -m "feat(server): POST /:id/retry reads strategy from body"
```

### Task 1.7: Verify Chunk 1 builds end-to-end

- [ ] **Step 1: Full server build**

Run: `timeout 120 pnpm --filter @omega/server build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 2: Server tests pass**

Run: `timeout 90 pnpm --filter @omega/server test 2>&1 | tail -10`
Expected: exit 0, both new tests pass + any existing tests stay green.

- [ ] **Step 3: Restart server with new bundle, confirm no migration errors**

```bash
pkill -f 'apps/server/dist/index.js' 2>/dev/null
sleep 2
rm -f ~/.omega/pglite-data/postmaster.pid
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 6
tail -5 /tmp/omega-server.log
lsof -nP -iTCP:4000 -sTCP:LISTEN | tail -1
```
Expected: server boots cleanly, no errors, listening on 4000.

- [ ] **Step 4: Smoke test — verify the named-strategy dispatch works**

Discover a failed task:

```bash
FAILED_ID=$(curl -s "http://127.0.0.1:4000/tasks?status=failed&limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.tasks?.[0]?.id ?? '')})")
echo "FAILED_ID=$FAILED_ID"
```

If that's empty, create a failed internal task and let it fail (note: `clean-retry` is the only strategy that works for internal tasks — `tier-escalation`/`different-provider` need a real codex ladder, `different-cli` needs an `external:` tag):

```bash
LIVE_ID=$(node apps/cli/dist/index.js task create --project c6fa6a9a-030d-4104-aea5-2e92dfbb029d --title "smoke-retry" --description "noop" --complexity simple 2>&1 | grep -oE '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X POST "http://127.0.0.1:4000/tasks/$LIVE_ID/run" -H 'Content-Type: application/json' -d '{"detached":true}' > /dev/null
# Poll until status=failed (max 90s) instead of a flat sleep.
for i in $(seq 1 18); do
  STATUS=$(curl -s "http://127.0.0.1:4000/tasks/$LIVE_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).status ?? '')})")
  if [ "$STATUS" = "failed" ]; then break; fi
  sleep 5
done
FAILED_ID=$LIVE_ID
```

Then call the retry endpoint with `clean-retry` (the only strategy guaranteed to apply for an internal task):

```bash
curl -s -w "HTTP %{http_code}\n" -X POST "http://127.0.0.1:4000/tasks/$FAILED_ID/retry" \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"clean-retry"}'
```

Expected: `HTTP 202` (the request is accepted; the task moves to `in_progress` and the new attempt begins in the background).

For a known historical failed task id (if available from earlier E2E runs — the plan does NOT depend on this being present), use `c19a6ece-341c-4630-a89b-8e02e67f4e8f` (the failed codex task from the live phase stream demo).

- [ ] **Step 5: No commit — verification only.**

---

## Chunk 2: CLI — `task retry` + Watch Retry Line + API Hook

### Task 2.1: Add `retryTask` helper to the CLI api

**Files:**
- Modify: `apps/cli/src/api.ts`

- [ ] **Step 1: Add an exported `retryTask` helper that wraps `apiFetch`**

Open `apps/cli/src/api.ts`. The file currently exports `getApiUrl()` and `apiFetch(path, init?)`. Add a new top-level export `retryTask(id, strategy?)` that calls `apiFetch` directly (matching the file's existing style — no new `api = { … }` namespace):

```ts
export async function retryTask(id: string, strategy?: string): Promise<Record<string, unknown>> {
  return apiFetch(`/tasks/${id}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(strategy ? { strategy } : {}),
  }) as Promise<Record<string, unknown>>;
}
```

Place it near the bottom of the file, after the existing `apiFetch` definition. Note: the CLI's task payload is `Record<string, unknown>` (matches how `taskCmd` subcommands already consume API responses — see `runTask` at `apps/cli/src/commands/task.ts:540`).

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3`
Expected: exit 0.

(If pnpm hangs, fall back to `timeout 180 node node_modules/typescript/bin/tsc -p apps/cli 2>&1 | tail -3`.)

- [ ] **Step 3: No commit — continue to Task 2.2.**

### Task 2.2: Add `task retry <id> [--strategy]` subcommand

**Files:**
- Modify: `apps/cli/src/commands/task.ts` (add new subcommand near the end, after `orchestrate`)
- Modify: `apps/cli/src/commands/task.ts` (add import for `retryTask`)

- [ ] **Step 1: Add the import**

In `apps/cli/src/commands/task.ts`, find the existing import line that pulls from `../api.js` (it currently imports `apiFetch` and `getApiUrl`). Add `retryTask`:

```ts
import { apiFetch, getApiUrl, retryTask } from '../api.js';
```

- [ ] **Step 2: Append the subcommand**

In `apps/cli/src/commands/task.ts`, after the `.command('orchestrate')` block (ending around line 587), add:

```ts
taskCmd
  .command('retry')
  .description('Retry a failed task, optionally with a specific strategy')
  .argument('<id>', 'task id')
  .option('--strategy <name>', 'specific strategy: clean-retry | tier-escalation | different-provider | orchestrated-fallback | different-cli')
  .action(async (id: string, opts: { strategy?: string }) => {
    const result = await retryTask(id, opts.strategy);
    console.log(JSON.stringify(result, null, 2));
  });
```

This goes after `orchestrate` so it sits with the other run/orchestrate/retry family of commands.

- [ ] **Step 3: Verify it typechecks + lints clean**

Run: `timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3`
Expected: exit 0.

Run: `timeout 30 node node_modules/eslint/bin/eslint.js apps/cli/src/commands/task.ts 2>&1 | tail -15`
Expected: shows only pre-existing errors (no new ones near the new subcommand).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/task.ts
git commit -m "feat(cli): task retry subcommand with --strategy"
```

### Task 2.3: Surface retry line in `task watch` (snapshot header + live retry detection)

**Files:**
- Modify: `apps/cli/src/commands/task.ts:75-124` (the `watchTask` function, particularly the header print at ~line 78-92 and the `onFrame` agent-run handler at ~line 195-225)

- [ ] **Step 1: Add retry header to `watchTask` snapshot**

In `apps/cli/src/commands/task.ts`, inside `watchTask`, find the header print block that appears right after fetching the task (around line 78-92, the block with `attaching to ${taskId.slice(0, 8)} — ${sanitizeTitle(title)}`).

Immediately after that block, add:

```ts
  // If the task has been retried before, surface that in the attach header.
  let lastTurn = 0;
  if (typeof task.retryCount === 'number' && task.retryCount > 0) {
    const historyRaw = typeof task.retryHistory === 'string' ? task.retryHistory : null;
    let lastStrategy = '';
    let lastModel = '';
    if (historyRaw) {
      try {
        const arr = JSON.parse(historyRaw) as Array<{ strategy: string; provider?: string | null; model?: string | null }>;
        const last = arr[arr.length - 1];
        if (last) {
          lastStrategy = last.strategy;
          lastModel = typeof last.model === 'string' ? last.model : '';
        }
      } catch { /* ignore malformed history */ }
    }
    const modelPart = lastModel ? `, ${lastModel}` : '';
    console.log(`  ↻ retried ${String(task.retryCount)}× (last: ${lastStrategy}${modelPart})`);
  }
```

This requires extending the `task` type in `watchTask` to include `retryCount` + `retryHistory` (currently it's typed as the API's task row which DOES include those fields as `retryHistory: string | null` per spec §5.4).

- [ ] **Step 2: Track `lastTurn` and detect retry-via-turn-reset in the live `agent-run` handler**

In the same file, in `watchTask`, find the live `agent-run` event handler (around line 195-225). The `lastTurn` variable declared in Step 1 is in scope (closure of `onFrame`).

In the `case 'agent-run':` block, immediately after the `parts.push(...)` calls, add:

```ts
          // Detect a retry attempt by a currentTurn reset (previous run ended at a higher turn).
          if (typeof parsed.currentTurn === 'number' && parsed.currentTurn === 1 && lastTurn > 1) {
            const phasePart = typeof parsed.currentPhase === 'string' ? ` (phase: ${parsed.currentPhase})` : '';
            console.log(`[${ts}] ↻ retry attempt starting${phasePart}`);
          }
          if (typeof parsed.currentTurn === 'number') lastTurn = parsed.currentTurn;
```

Note: the `agent-run` SSE frame does NOT carry `provider`/`model` — those live on the initial snapshot or the `task` event. We surface the phase (which IS on `agent-run` via the codex phase stream feature) rather than guessing provider/model. If a future enhancement adds provider/model to the agent-run event, extend the line accordingly.

- [ ] **Step 3: Verify typecheck + lint clean**

Run: `timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3`
Expected: exit 0.

Run: `timeout 30 node node_modules/eslint/bin/eslint.js apps/cli/src/commands/task.ts 2>&1 | tail -15`
Expected: shows only pre-existing errors (no new ones near the new code).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/task.ts
git commit -m "feat(cli): surface retry count in task watch + detect live retry"
```

### Task 2.4: Verify Chunk 2 builds + CLI smoke

- [ ] **Step 1: Full CLI build**

Run: `timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3`
Expected: exit 0.

- [ ] **Step 2: Restart server with new bundle (so the `task retry` endpoint exists)**

```bash
pkill -f 'apps/server/dist/index.js' 2>/dev/null
sleep 2
rm -f ~/.omega/pglite-data/postmaster.pid
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 6
lsof -nP -iTCP:4000 -sTCP:LISTEN | tail -1
```
Expected: server boots, listening on 4000.

- [ ] **Step 3: Smoke — `task retry <id> --strategy clean-retry`**

```bash
FAILED_ID=$(curl -s "http://127.0.0.1:4000/tasks?status=failed&limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).tasks?.[0]?.id ?? '')})")
if [ -z "$FAILED_ID" ]; then
  echo "no failed task found — cannot verify retry path; manually trigger a failure and re-run"
  exit 1
fi
echo "FAILED_ID=$FAILED_ID"
timeout 10 node apps/cli/dist/index.js task retry "$FAILED_ID" --strategy clean-retry 2>&1 | grep -v Warning | grep -v trace-warnings
```

Expected: the command prints the retry response (`status: 'in_progress'`, `strategy: 'clean-retry'`, `retryCount: N+1`). The check is non-trivial — if no failed task exists, the smoke test FAILS loudly rather than silently passing.

- [ ] **Step 4: Verify `task watch <id>` header shows retry line**

Re-discover a failed task (don't rely on `$FAILED_ID` from Step 3 — each bash invocation is a separate shell):

```bash
FAILED_ID=$(curl -s "http://127.0.0.1:4000/tasks?status=failed&limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).tasks?.[0]?.id ?? '')})")
if [ -z "$FAILED_ID" ]; then
  echo "no failed task found — cannot verify task watch retry line"
  exit 1
fi
timeout -s INT 8 node apps/cli/dist/index.js task watch "$FAILED_ID" 2>&1 | grep -v Warning | grep -v trace-warnings
```

Expected: if `retryCount > 0`, the header line `↻ retried N× (last: <strategy>, <model>)` is printed.

- [ ] **Step 5: No commit — verification only.**

---

## Chunk 3: Web UI — `Task` Interface, Retry Button, Retry Badge, Verification

### Task 3.1: Expand the `Task` interface in `TaskBoard.tsx`

**Files:**
- Modify: `apps/web/src/components/TaskBoard.tsx:5-18` (`Task` interface)

- [ ] **Step 1: Add the three retry fields to the `Task` interface**

In `apps/web/src/components/TaskBoard.tsx`, extend the `Task` interface (currently lines 5-18) by adding:

```ts
  retryCount: number;
  retryHistory: string | null;  // JSON string (parse at consumer)
  lastRetryAt: string | null;
```

Place these fields after the existing `error?: string | null;` line (line 16). The full interface becomes:

```ts
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  complexity: string;
  tags?: string;
  provider?: string | null;
  model?: string | null;
  result?: string | null;
  error?: string | null;
  retryCount: number;
  retryHistory: string | null;
  lastRetryAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/web build 2>&1 | tail -5`
Expected: exit 0. (The new fields are populated by `GET /tasks/:id` which already returns the full Prisma row, so no consumer changes are needed.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/TaskBoard.tsx
git commit -m "feat(web): add retryCount/retryHistory/lastRetryAt to Task interface"
```

### Task 3.2: Add `retryTask(id, strategy?)` to the web `api`

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add `retryTask` next to the existing `runTask`**

In `apps/web/src/lib/api.ts`, find the existing `runTask` definition (line 79), and add immediately after:

```ts
  retryTask: (id: string, strategy?: string) =>
    request<Task>(`/tasks/${id}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(strategy ? { strategy } : {}),
    }),
```

- [ ] **Step 2: Verify it typechecks**

Run: `timeout 120 pnpm --filter @omega/web build 2>&1 | tail -5`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): retryTask api for POST /tasks/:id/retry"
```

### Task 3.3: Add Retry button + strategy picker to TaskBoard task cards (spec deviation acknowledged)

**Files:**
- Modify: `apps/web/src/components/TaskBoard.tsx` (add Retry UI inline next to the existing Run button)

**Spec deviation (acknowledged):** The spec §5.2 places the Retry button + picker inside `TaskDetail.tsx` and uses a "click to open" picker interaction. This plan implements the Retry button INLINE in `TaskBoard.tsx` with an always-visible strategy dropdown — same functional outcome, simpler implementation, avoids prop drilling. If a future revision wants the click-to-open affordance, split this into a separate `RetryButton` component.

- [ ] **Step 1: Add state + `handleRetry` function + the Retry group button**

In `apps/web/src/components/TaskBoard.tsx`, find:

- `const [, setForm] = useState<...>` (the existing form state near the top of the function) — add a sibling `retryingId` state right after it:

```tsx
  const [retryingId, setRetryingId] = useState<string | null>(null);
```

- `async function handleRun(id: string) { ... }` — add a sibling `handleRetry` right after:

```tsx
  async function handleRetry(taskId: string, strategy?: string) {
    setRetryingId(taskId);
    try {
      await api.retryTask(taskId, strategy);
      await load();
    } finally {
      setRetryingId(null);
    }
  }
```

- The button row inside each task card — find the existing `<div className="flex gap-2">` block containing the "Details" / "Run" buttons (search for `className="flex gap-2"` and the literal text "Run"). Add this Retry group immediately after the Run `<button>...</button>`:

```tsx
                        {status === 'failed' && (
                          <div className="flex gap-1">
                            <select
                              value=""
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v) void handleRetry(t.id, v);
                                e.currentTarget.value = '';
                              }}
                              className="text-[10px] border rounded px-1"
                              disabled={retryingId === t.id}
                            >
                              <option value="" disabled>↻ strategy…</option>
                              <option value="clean-retry">clean-retry</option>
                              <option value="tier-escalation">tier-escalation</option>
                              <option value="different-provider">different-provider</option>
                              <option value="orchestrated-fallback">orchestrated-fallback</option>
                              <option value="different-cli">different-cli</option>
                            </select>
                            <button
                              onClick={() => { void handleRetry(t.id); }}
                              disabled={retryingId === t.id}
                              className="px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700 disabled:opacity-50"
                            >
                              {retryingId === t.id ? '↻…' : '↻ Retry'}
                            </button>
                          </div>
                        )}
```

(Note: no `defaultValue` — the input is controlled via `value=""`. After dispatching the change, we reset `e.currentTarget.value` directly so the placeholder stays selected without needing React state.)

- [ ] **Step 2: Verify it typechecks + lints**

Run: `timeout 120 pnpm --filter @omega/web build 2>&1 | tail -5`
Expected: exit 0.

Run: `timeout 30 node node_modules/eslint/bin/eslint.js apps/web/src/components/TaskBoard.tsx 2>&1 | tail -10`
Expected: shows only pre-existing errors (no new ones near the new code).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/TaskBoard.tsx
git commit -m "feat(web): Retry button + strategy picker on failed task cards"
```

### Task 3.4: Add `↻ N×` retry badge to task cards in TaskBoard

**Files:**
- Modify: `apps/web/src/components/TaskBoard.tsx` (the task card render, near where status + tags are displayed)

- [ ] **Step 1: Add the retry badge next to the existing complexity tag**

In `apps/web/src/components/TaskBoard.tsx`, find the tag block inside the task card render (search for the text `className="flex flex-wrap gap-1 mb-2"` — the block that holds complexity + external:* + tag pills). After the existing tag pills (after the `.map((tag) => ...)` for tags), add the retry badge:

```tsx
                      {t.retryCount > 0 && (
                        <RetryBadge task={t} />
                      )}
```

Where `<RetryBadge task={t} />` is the same component:

```tsx
function RetryBadge({ task }: { task: Task }) {
  let lastStrategy = '';
  let lastModel = '';
  if (task.retryHistory) {
    try {
      const arr = JSON.parse(task.retryHistory) as Array<{ strategy: string; model?: string | null }>;
      const last = arr[arr.length - 1];
      if (last) {
        lastStrategy = last.strategy;
        lastModel = typeof last.model === 'string' ? last.model : '';
      }
    } catch { /* ignore malformed history */ }
  }
  const modelPart = lastModel ? ` (${lastModel})` : '';
  return (
    <span
      className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs"
      title={`Retried ${String(task.retryCount)}× — last: ${lastStrategy}${modelPart}`}
    >
      ↻ {task.retryCount}×
    </span>
  );
}
```

Define `RetryBadge` at the bottom of the file (next to the existing helper functions like `tagsList` and `externalCli`).

(TODO: the spec §5.3 calls for a "compact list" of all attempts. For now we surface only the last; expand to a multi-line tooltip later if needed.)

- [ ] **Step 2: Verify it typechecks + lints**

Run: `timeout 120 pnpm --filter @omega/web build 2>&1 | tail -5`
Expected: exit 0.

Run: `timeout 30 node node_modules/eslint/bin/eslint.js apps/web/src/components/TaskBoard.tsx 2>&1 | tail -10`
Expected: shows only pre-existing errors (no new ones near the new code).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/TaskBoard.tsx
git commit -m "feat(web): ↻ N× retry badge on task cards with retry history"
```

### Task 3.5: Rebuild + redeploy web bundle

- [ ] **Step 1: Clear Vite cache and rebuild**

```bash
rm -rf apps/web/node_modules/.vite apps/web/dist
timeout 120 pnpm --filter @omega/web build 2>&1 | tail -5
```
Expected: exit 0; new bundle hash (e.g. `index-XYZ.js`).

- [ ] **Step 2: Wipe stale hashed assets in the server web dir, copy fresh ones**

```bash
mkdir -p apps/server/web/assets
rm -f apps/server/web/assets/index-*.js apps/server/web/assets/index-*.css
cp apps/web/dist/index.html apps/server/web/index.html
cp apps/web/dist/assets/index-*.js apps/server/web/assets/
cp apps/web/dist/assets/index-*.css apps/server/web/assets/
ls apps/server/web/assets/
```

Expected: only the new `index-*.js` + `index-*.css` files (no stale hashed assets).

- [ ] **Step 3: Restart the server**

```bash
pkill -f 'apps/server/dist/index.js' 2>/dev/null
sleep 2
rm -f ~/.omega/pglite-data/postmaster.pid
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 6
lsof -nP -iTCP:4000 -sTCP:LISTEN | tail -1
```

Expected: server boots cleanly, listening on 4000.

- [ ] **Step 4: Verify the new bundle is served**

```bash
curl -s http://127.0.0.1:4000/ | grep -oE 'index-[A-Za-z0-9_-]+\.(js|css)'
```

Expected: prints the new hash.

- [ ] **Step 5: Verify the new strings are bundled**

```bash
curl -s "http://127.0.0.1:4000/assets/index-$(curl -s http://127.0.0.1:4000/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1 | sed 's/index-//;s/\.js//').js" | grep -oE '"(Retried|strategy|↻)"'
```

Expected: at least one of the new strings (`Retried`, `↻`) appears.

- [ ] **Step 6: No commit — verification only.**

### Task 3.6: Final smoke verification — full repo build, tests, E2E

- [ ] **Step 1: All package builds pass**

Run:
```bash
timeout 90 pnpm --filter @omega/agent build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/server build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/cli build 2>&1 | tail -3
timeout 90 pnpm --filter @omega/web build 2>&1 | tail -5
```
Expected: all four exit 0.

- [ ] **Step 2: Agent tests pass**

Run: `timeout 90 pnpm --filter @omega/agent test 2>&1 | tail -10`
Expected: exit 0, all 14 tests pass.

- [ ] **Step 3: Server tests pass**

Run: `timeout 90 pnpm --filter @omega/server test 2>&1 | tail -10`
Expected: exit 0, the new 2 retry tests pass + any existing tests stay green.

- [ ] **Step 4: Restart server with new bundle**

```bash
pkill -f 'apps/server/dist/index.js' 2>/dev/null
sleep 2
rm -f ~/.omega/pglite-data/postmaster.pid
OMEGA_AUDIT_OUTPUT_DIR=/Volumes/gamma-systems-2/omega-victoria-data CODEX_MODEL=gpt-5.6-luna CODEX_EFFORT=max nohup node apps/server/dist/index.js > /tmp/omega-server.log 2>&1 &
sleep 6
lsof -nP -iTCP:4000 -sTCP:LISTEN | tail -1
```

Expected: server boots cleanly, listening on 4000.

- [ ] **Step 5: Run the E2E**

Run: `timeout 300 node /tmp/omega-e2e.mjs 2>&1 | tail -8`
Expected: `Summary  …passed, 0 failed`, exit 0 (the E2E exercises the API surface; it may not exercise retry directly, but it should still pass).

- [ ] **Step 6: No commit — verification only.**