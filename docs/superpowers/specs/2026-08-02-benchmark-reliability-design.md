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
- `runner.ts`: declare `taskError` at the function level alongside `status` (the existing `let` block at runner.ts:61-69), assign it inside the try after `waitForTask`:

```ts
// runner.ts:61-69 — the existing let-block gains one more:
let status: BenchmarkResult['status'] = 'failed';
let taskError: string | undefined;   // NEW: capture the server-side task error
// ... (agentRun, diffs, etc. unchanged)

// inside the try, after waitForTask:
status = finished.status === 'timeout' ? 'timeout' : (finished.status as BenchmarkResult['status']);
taskError = finished.error;   // NEW: never drop the server's reason
```

Then in the `BenchmarkResult` construction (runner.ts:139), add `taskError`. Also — when the evaluation message is empty but `taskError` is present, use the taskError as the message fallback so the report never shows a blank error:

```ts
if (!evaluation.message && taskError) {
  evaluation = { ...evaluation, message: taskError };
}
```

And in the catch block (runner.ts:131-136) — prefer `taskError` as the message when `evaluate()` itself threw after `waitForTask` returned a failed task with an error (so the real server-side reason isn't clobbered by the downstream exception):

```ts
} catch (err) {
  const thrownMessage = err instanceof Error ? err.message : String(err);
  evaluation = {
    passed: false,
    message: taskError && !taskError.startsWith('fetch failed') ? taskError : thrownMessage,
  };
}
```

(Use `taskError` when it carries a real server-side reason; fall back to the thrown message when taskError is missing or itself just an infra fetch failure.)

- `classifyFailure` (analyse.ts:143): add a branch at the top — if `result.taskError` is present and matches infra patterns (`rate|limit|quota|429|provider.*error|fetch failed|unreachable|ECONNRESET`), classify as a real category instead of falling through to `unknown`. `FailureCategory` (types.ts:124-138) currently has NO `rate_limit`/`provider_error`/`infra` members — add them to the union (cheap, honest taxonomy; `model_error` already exists but is agent-focused):

```ts
export type FailureCategory =
  | 'install_failure'
  | 'dependency_error'
  | 'build_failure'
  | 'compile_error'
  | 'test_failure'
  | 'verifier_timeout'
  | 'patch_apply_failed'
  | 'model_error'
  | 'rate_limit'      // NEW: quota/429/rate-limit task errors
  | 'provider_error'  // NEW: provider crash / fetch failed / ECONNRESET / unreachable
  | 'infra'           // NEW: generic runner↔server infra failures
  | 'timeout'
  | 'validation_failure'
  | 'tool_misuse'
  | 'parse_error'
  | 'plan_error'
  | 'unknown';
```

The new branch in `classifyFailure` maps: `rate|limit|quota|429` → `rate_limit`; `fetch failed|unreachable|ECONNRESET|provider.*error` → `provider_error`; anything else infra-shaped → `infra`. Reuse `withLog` for the evidence format; add the pattern rules to the `EVIDENCE_RULES`/`matchEvidence` machinery (analyse.ts:58-99) OR use a dedicated regex — whichever is cleaner given the existing structure.

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

**Critical correction from review:** `runCommand` (deepswe.ts:853-884) does NOT throw on timeout — it swallows ALL errors and returns `{ stdout, stderr, exitCode: e.code ?? 1 }`. For a Node timeout-kill, the error has `code: null, killed: true, signal: 'SIGTERM'`, so a timeout today looks identical to a real verifier failure (exitCode 1, no `timedOut` flag). A try/catch around `runCommand` would be dead code. The fix must be **inside** `runCommand` — expose a `timedOut` flag on its return.

**Step 1: Extend `runCommand`'s return type + capture the timeout condition** (deepswe.ts:853-884):

```ts
async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, COREPACK_INTEGRITY_KEYS: '0', COREPACK_ENABLE_AUTO_PIN: '0', ...options.env },
      timeout: options.timeout ?? 600000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0, timedOut: false };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string; killed?: boolean; signal?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exitCode: e.code ?? 1,
      timedOut: Boolean(e.killed || e.signal === 'SIGTERM'),
    };
  }
}
```

`runCommand` is file-local with ~40 call sites; adding an optional `timedOut` field to the return is safe (existing callers destructure only what they need). Existing callers see `timedOut: false` on success.

**Step 2: Key the verifier off `timedOut`** — `runDeepSWEVerifierLocal` (deepswe.ts:1433-1448):

```ts
const testRun = await runCommand('bash', [localTestSh], {
  cwd: projectPath,
  env,
  timeout: 1_800_000,
});
log(`=== test.sh stdout ===\n${testRun.stdout}`);
log(`=== test.sh stderr ===\n${testRun.stderr}`);

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

return { reward, logs, logFile, exitCode: testRun.exitCode, timedOut: testRun.timedOut };
```

Update the verifier return type (`Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number; timedOut: boolean }>`) for both the Docker + local paths, and `evaluate` (deepswe.ts:1519-1547) to surface it:

```ts
const passed = reward.reward === 1;
const metrics: Record<string, number | string> = {
  f2p_passed: reward.f2p_passed ?? 0,
  f2p_total: reward.f2p_total ?? 0,
  p2p_passed: reward.p2p_passed ?? 0,
  p2p_total: reward.p2p_total ?? 0,
  partial: reward.partial ?? 0,
  verifier_exit_code: exitCode,
  verifier_log_file: logFile,
  ...(timedOut ? { verifier_timed_out: 1 } : {}),
};
if (reward.apply_failed) metrics.apply_failed = 1;
metrics.verifier_logs = logs.slice(-4096);
return {
  passed,
  score: reward.partial,
  message: passed
    ? `DeepSWE verifier passed (f2p ${String(reward.f2p_passed ?? 0)}/${String(reward.f2p_total ?? 0)}, p2p ${String(reward.p2p_passed ?? 0)}/${String(reward.p2p_total ?? 0)})`
    : timedOut
      ? `DeepSWE verifier timeout (reward=${String(reward.reward ?? 'missing')})`
      : `DeepSWE verifier failed (reward=${String(reward.reward ?? 'missing')}, f2p ${String(reward.f2p_passed ?? 0)}/${String(reward.f2p_total ?? 0)}, p2p ${String(reward.p2p_passed ?? 0)}/${String(reward.p2p_total ?? 0)})`,
  metrics,
};
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
- **`withRetry` masks real server-down conditions longer**: 3 attempts × (0.5+1+2)s ≈ 3.5s added latency per failing call. Combined with the consecutive-failure counter (3 polls), `waitForTask` declares "server unreachable" after ~10.5s of real downtime. Acceptable for a bench runner (tasks run 30s-5min). Documented here so nobody "fixes" it later.
- **`taskError` may duplicate evaluation.message** when both are set: the report prefers `evaluation.message`, falling back to `taskError` only when the former is empty. No duplication.
- **`runCommand` return-type change**: adding `timedOut` to ~40 call sites' return shape is safe (they destructure selectively), but the file-local type must be updated once. Existing callers see `timedOut: false` on success — no behavior change for them.

## Files touched

| File | Change | LOC |
|---|---|---|
| `packages/bench/src/api-client.ts` | `withRetry` helper + retry on critical calls + warn on swallowed accessors | +40 |
| `packages/bench/src/runner.ts` | `let taskError` + capture `finished.error` + message fallback in catch | +10 |
| `packages/bench/src/types.ts` | `taskError?: string` on `BenchmarkResult` + 3 new `FailureCategory` members | +4 |
| `packages/bench/src/report.ts` | render `taskError` fallback in resultLine | +2 |
| `packages/bench/src/analyse.ts` | infra-pattern classification branch using `taskError` | +15 |
| `packages/bench/src/adapters/deepswe.ts` | `runCommand` `timedOut` flag + verifier keys off it + metrics + message | +20 |
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
