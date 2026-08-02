# Benchmark Reliability — Design

**Date:** 2026-08-02
**Status:** Draft (pre-implementation)
**Owner:** Omega harness

## Problem

The most recent benchmark run (harder-v2, `benchmark-2026-07-25T10-22-14-048Z`) scored 9/10 — the single failure was `fetch failed` with no other context: a transient runner↔server connection drop that the runner treats as a hard task failure. Three separate defects make this class of failure indistinguishable from a real agent/verifier failure:

1. **No retry on runner↔server HTTP calls.** `packages/bench/src/api-client.ts` uses bare `fetch` everywhere. `waitForTask` polls `GET /tasks/:id` every 300ms; a single dropped connection throws out of `runBenchmark`'s try block, marking the whole task `failed` with message `fetch failed`.

2. **Error context discarded in 3 places.** `runner.ts:99-100` never reads `finished.error` from `waitForTask` (the task row's `error` field — which carries the real reason like "provider crashed" or "rate limited"). `api-client.ts`'s `getAgentRun`/`getDiffs`/`getTraceFlow`/`getTraceSummary` all `.catch(() => undefined/[])` — silently swallowing failures. `report.ts:19` renders `evaluation.message ? ... : ''` — blank line when the evaluator returns no message.

3. **DeepSWE verifier timeouts are invisible.** `runDeepSWEVerifierLocal` (deepswe.ts:1433-1448) runs `bash test.sh` via `runCommand(..., { timeout: 1_800_000 })`. When the verifier times out, `runCommand` throws — so the log-writing + `reward.json` read that follow never execute, and the report shows only a bare `timeout` with no log tail. Half the DeepSWE failures are env/verifier flake, but today they're indistinguishable from agent failures.

## Goal

Make benchmark failures **real**: transient infra noise is retried away, and every remaining failure carries the actual error context (task error, verifier logs) so a 9/10 run with one `fetch failed` becomes a 10/10 run — and the failures that DO remain are diagnosable.

## Non-goals

- Changing the server-side runner (`apps/server/src/lib/benchmark-runner.ts`) — it runs in-process (no HTTP flake) and persists `error` per task already. Separate work.
- Wiring strategies/consensus into `bench run` (a different improvement; this spec is only reliability).
- Isolated subtask worktrees for the orchestrator.

## Design

### 1. Bounded retry with exponential backoff in `api-client.ts`

Add a `withRetry` helper to `packages/bench/src/api-client.ts`:

```ts
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERR = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|UND_ERR/i;

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = err instanceof ApiError ? err.status : 0;
      const retryable = RETRYABLE_STATUS.has(status) || RETRYABLE_ERR.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}
```

Apply it to the critical-path calls: `ensureProject`, `createTask`, `runTask`, and the inner `getTask` used by `waitForTask`. These are the calls that, if they fail transiently, currently kill the entire task.

`waitForTask` itself: wrap the poll body so a transient failure does NOT abort the loop. Track consecutive failures; only give up after N consecutive (default 3) failed polls — proving the server is down, not just flaky:

```ts
export async function waitForTask(
  apiUrl: string,
  taskId: string,
  timeoutMs = 120000,
  consecutiveFailLimit = 3,
): Promise<{ status: string; result?: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveFails = 0;
  while (Date.now() < deadline) {
    try {
      const task = await withRetry(() => getTask(apiUrl, taskId));
      consecutiveFails = 0;
      if (task.status === 'done' || task.status === 'failed') return task;
    } catch (err) {
      consecutiveFails++;
      if (consecutiveFails >= consecutiveFailLimit) {
        return {
          status: 'failed',
          error: `Server unreachable for ${String(consecutiveFailLimit)} consecutive polls: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { status: 'timeout', error: 'Task did not finish in time' };
}
```

### 2. Surface task error into the result

- Add `taskError?: string` to `BenchmarkResult` (types.ts:94).
- `runner.ts`: after `waitForTask`, capture `finished.error` into the result:

```ts
status = finished.status === 'timeout' ? 'timeout' : (finished.status as BenchmarkResult['status']);
const taskError = finished.error;
```

Then in the `BenchmarkResult` construction, add `taskError`. Also — when the evaluation message is empty but `taskError` is present, use the taskError as the message fallback so the report never shows a blank error:

```ts
if (!evaluation.message && taskError) {
  evaluation = { ...evaluation, message: taskError };
}
```

- `classifyFailure` (analyse.ts:143): add a branch at the top — if `result.taskError` is present and matches infra patterns (`rate|limit|quota|429|provider.*error|fetch failed|unreachable`), classify as `rate_limit` / `provider_error` / `infra` instead of falling through to `unknown`. Reuse the existing `matchEvidence` + `withLog` helpers.

- `report.ts:19`: change `const msg = r.evaluation.message ? ... : '';` to always render something — `r.taskError` when the evaluation message is empty:

```ts
const msg = (r.evaluation.message || r.taskError) ? ` — ${r.evaluation.message || r.taskError}` : '';
```

- `api-client.ts` accessors: keep the `.catch(() => undefined/[])` fallbacks (they're best-effort reads that shouldn't fail a run), but add `console.warn` with the error so a swallowed failure is at least visible in the log:

```ts
export async function getAgentRun(apiUrl: string, taskId: string): Promise<AgentRunInfo | undefined> {
  try {
    return await apiFetch<AgentRunInfo>(`${apiUrl}/tasks/${taskId}/agent-run`);
  } catch (err) {
    console.warn(`getAgentRun(${taskId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
```

(Same for `getDiffs`, `getTraceFlow`, `getTraceSummary`, `getPromptVersion`.)

### 3. DeepSWE verifier timeout diagnostics

`packages/bench/src/adapters/deepswe.ts` — `runDeepSWEVerifierLocal` (and the Docker path): wrap the `runCommand('bash', [localTestSh], ...)` in try/catch. On timeout (the throw), still write the log file and return a structured result so `evaluate` reports the timeout with a log tail:

```ts
let testRun: { stdout: string; stderr: string; exitCode: number } | null = null;
let timedOut = false;
try {
  testRun = await runCommand('bash', [localTestSh], { cwd: projectPath, env, timeout: 1_800_000 });
} catch (err) {
  timedOut = true;
  const message = err instanceof Error ? err.message : String(err);
  log(`=== test.sh FAILED ===\n${message}`);
  // runCommand may include partial stdout/stderr in the error; capture if available.
  const partial = err as { stdout?: string; stderr?: string } | null;
  if (partial?.stdout) log(`=== test.sh partial stdout ===\n${partial.stdout}`);
  if (partial?.stderr) log(`=== test.sh partial stderr ===\n${partial.stderr}`);
}
if (testRun) {
  log(`=== test.sh stdout ===\n${testRun.stdout}`);
  log(`=== test.sh stderr ===\n${testRun.stderr}`);
}

let reward: Reward = {};
try {
  const rewardRaw = await fs.readFile(path.join(verifierDir, 'reward.json'), 'utf-8');
  reward = JSON.parse(rewardRaw) as Reward;
} catch {
  // reward.json may be missing if verifier crashed.
}

const logs = logLines.join('\n');
await fs.writeFile(logFile, logs, 'utf-8').catch(() => {
  // ignore write errors
});

return {
  reward,
  logs,
  logFile,
  exitCode: testRun?.exitCode ?? (timedOut ? -1 : 0),
  timedOut,
};
```

Update the `Reward`-returning type + `evaluate` in the task to include `timedOut` in metrics + message:

```ts
const passed = reward.reward === 1;
// ... metrics ...
if (timedOut) metrics.verifier_timed_out = 1;
message: passed
  ? `DeepSWE verifier passed (...)`
  : timedOut
    ? `DeepSWE verifier timeout (reward=${String(reward.reward ?? 'missing')})`
    : `DeepSWE verifier failed (reward=${String(reward.reward ?? 'missing')}, ...)`,
```

## Data flow

```
1. bench run starts task via HTTP.
2. transient fetch failure on GET /tasks/:id → withRetry retries 3x with backoff.
   - Succeeds: task continues.
   - Fails all 3: waitForTask counts a consecutive failure; keeps polling up to 3 consecutive fails.
     - If server recovers: task continues.
     - If server down for 3+ polls: waitForTask returns { status:'failed', error:'Server unreachable...' }.
3. runner.ts captures finished.error → taskError → result.taskError.
4. evaluate runs; if it produced no message, taskError is the fallback message.
5. report.ts renders taskError (never blank).
6. classifyFailure sees taskError + infra patterns → rate_limit/provider_error/infra.
7. (DeepSWE path) verifier timeout → timedOut=true, log file written, reward missing →
   message 'DeepSWE verifier timeout (reward=missing)', metrics.verifier_timed_out=1,
   metrics.verifier_logs = log tail.
```

## Risks

- **Retrying non-idempotent calls**: `createTask` and `runTask` are not strictly idempotent (a retry after the server received the request could create a duplicate task or double-run). The window is small (retry only on transport-level failures, not on 4xx). For `createTask`, a 409 already handles the existing-project case. For `runTask`, the server's own queue dedups by task id — a duplicate POST /run for an already-running task is a no-op (the queue is keyed by taskId). Acceptable; document in the code comment.
- **`withRetry` masks real server-down conditions longer**: 3 attempts × (0.5+1+2)s ≈ 3.5s added latency per failing call. Acceptable for a bench runner (tasks run 30s-5min).
- **`taskError` may duplicate evaluation.message** when both are set: the report prefers `evaluation.message`, falling back to `taskError` only when the former is empty. No duplication.
- **DeepSWE verifier partial-stdout capture**: `runCommand` may not attach stdout/stderr to its thrown error (depends on implementation). We best-effort capture; the log tail from `test.sh`'s own progress (written by the verifier script) is the primary diagnostic.

## Files touched

| File | Change | LOC |
|---|---|---|
| `packages/bench/src/api-client.ts` | `withRetry` helper + retry on critical calls + warn on swallowed accessors | +40 |
| `packages/bench/src/runner.ts` | capture `finished.error` → `taskError` + message fallback | +8 |
| `packages/bench/src/types.ts` | `taskError?: string` on `BenchmarkResult` | +1 |
| `packages/bench/src/report.ts` | render `taskError` fallback in resultLine | +2 |
| `packages/bench/src/analyse.ts` | infra-pattern classification branch using `taskError` | +12 |
| `packages/bench/src/adapters/deepswe.ts` | verifier try/catch + `timedOut` + metrics + message | +25 |
| `packages/bench/src/__tests__/api-client.test.ts` (new) | retry + waitForTask transient-failure tests | +60 |
| `packages/bench/src/__tests__/runner.test.ts` (new) | taskError capture test (mock API) | +50 |

Total: ~8 files, ~200 LOC (incl. tests).

## Acceptance criteria

1. `withRetry` retries on 429/5xx/transport errors, with backoff, up to N attempts; non-retryable errors throw immediately.
2. `waitForTask` survives 1-2 transient poll failures (consecutive-failure counter), and only returns `failed` after 3 consecutive failures with a clear "Server unreachable" error.
3. `benchmark-latest.json`-style report with a `fetch failed` failure now classifies it as infra (`infra`/`provider_error`/`rate_limit` — whichever pattern matches) instead of `unknown`.
4. A failed task with `task.error` set produces a non-blank error line in the report.
5. DeepSWE verifier timeout produces `DeepSWE verifier timeout (reward=missing)` + `metrics.verifier_timed_out=1` + `metrics.verifier_logs` tail, instead of a bare `timeout`.
6. Build clean: `pnpm --filter @omega/bench build` exits 0. New unit tests pass (the bench package previously had 0 tests — these are the first).
7. No regression: existing agent tests (14) + server tests (5) still pass.
