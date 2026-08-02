# Benchmark Reliability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make benchmark failures real — transient runner↔server infra noise is retried away, and every remaining failure carries the actual error context (task error, verifier logs) so a 9/10 run with one `fetch failed` becomes a 10/10 run, and the failures that remain are diagnosable.

**Architecture:** Add bounded retry with exponential backoff to the bench runner's critical HTTP calls (`withRetry` helper in `api-client.ts`); capture the server-side task error into the report (`taskError` on `BenchmarkResult`, never blank in `report.ts`, classified via 3 new `FailureCategory` members); expose verifier timeout via a `timedOut` flag on `runCommand` in the DeepSWE adapter.

**Tech Stack:** TypeScript, Node 18+, Vitest (already configured in `packages/bench`).

**Spec:** `docs/superpowers/specs/2026-08-02-benchmark-reliability-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/bench/src/api-client.ts` | Modify | `withRetry` helper + apply to `ensureProject`/`createTask`/`runTask`/`getTask`/PATCH; `waitForTask` consecutive-failure counter; `console.warn` on swallowed accessors. |
| `packages/bench/src/runner.ts` | Modify | `let taskError` (function-level); capture `finished.error`; catch-block prefers taskError; PATCH wrapped in withRetry. |
| `packages/bench/src/types.ts` | Modify | `taskError?: string` on `BenchmarkResult`; 3 new `FailureCategory` members. |
| `packages/bench/src/report.ts` | Modify | `resultLine` falls back to `taskError` when `evaluation.message` empty. |
| `packages/bench/src/analyse.ts` | Modify | classifyFailure top branch for infra patterns using `taskError`. |
| `packages/bench/src/adapters/deepswe.ts` | Modify | `runCommand` gains `timedOut` flag; verifier keys off it; `evaluate` reports `verifier timeout`. |
| `packages/bench/src/__tests__/api-client.test.ts` (new) | Create | withRetry + waitForTask transient-failure tests. |
| `packages/bench/src/__tests__/runner.test.ts` (new) | Create | taskError capture test (mock API). |

---

## Chunk 1: All Tasks

### Task 1.1: Add `withRetry` helper + retry on critical calls in `api-client.ts`

**Files:**
- Modify: `packages/bench/src/api-client.ts`

- [ ] **Step 1: Add the `withRetry` helper** near the top of the file (after the `ApiError` class):

```ts
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERR = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|UND_ERR/i;

export async function withRetry<T>(
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

- [ ] **Step 2: Wrap the critical-path calls** in `withRetry`:

- `ensureProject`: wrap ONLY the raw `fetch` POST at api-client.ts:23-28 (not the 409-handling GET fallback body):

```ts
export async function ensureProject(
  apiUrl: string,
  name: string,
  path: string
): Promise<{ id: string }> {
  const res = await withRetry(() =>
    fetch(`${apiUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    }),
  );
  if (res.status === 409) {
    // ... existing 409-handling body unchanged ...
  }
  if (!res.ok) throw new ApiError(res.status, `create project failed: ${String(res.status)}`);
  return res.json() as Promise<{ id: string }>;
}
```

- `createTask`: wrap the `apiFetch` call:

```ts
export async function createTask(
  apiUrl: string,
  projectId: string,
  title: string,
  options: { description?: string; complexity?: string; tags?: string[] } = {}
): Promise<{ id: string; status: string }> {
  return withRetry(() =>
    apiFetch(`${apiUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ... }),
    }),
  );
}
```

- `runTask`: wrap the `apiFetch` call similarly.
- **DO NOT wrap `getTask` here** — its only caller is `waitForTask`, which wraps it in `withRetry` already (Step 3). Wrapping both would nest `withRetry(withRetry(fetch))` → 9 attempts per counter increment, destroying the intended "3 failed polls ≈ 10.5s" semantics.
- Add a note in a comment near the retries: `createTask`/`runTask` are not strictly idempotent but the retry window is small (transport-level failures only) and the server queue dedups `runTask` by task id — a duplicate POST /run for an already-running task is a no-op.

- [ ] **Step 3: `waitForTask` — consecutive-failure counter**

Replace `waitForTask` (api-client.ts:70-82):

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

- [ ] **Step 4: `console.warn` on swallowed accessors**

For `getAgentRun`/`getDiffs`/`getTraceFlow`/`getTraceSummary`/`getPromptVersion` — add a `console.warn` in the existing catch (keep the fallback return):

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

(Same pattern for the other accessors.)

- [ ] **Step 5: Verify typecheck** — `timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3` exits 0.

- [ ] **Step 6: No commit — continue to Task 1.2.**

### Task 1.2: Capture `taskError` in `runner.ts` + add `BenchmarkResult`/`FailureCategory` types

**Files:**
- Modify: `packages/bench/src/runner.ts`
- Modify: `packages/bench/src/types.ts`

- [ ] **Step 1: Add `taskError?: string` to `BenchmarkResult`** in `types.ts:94-108` (after `status`):

```ts
export interface BenchmarkResult {
  task: BenchmarkTask;
  harnessTaskId: string;
  durationMs: number;
  status: 'done' | 'failed' | 'timeout';
  taskError?: string;
  evaluation: BenchmarkEvaluation;
  // ... rest unchanged
}
```

- [ ] **Step 2: Add 3 members to `FailureCategory`** in `types.ts:124-138` (after `'model_error'`):

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
  | 'rate_limit'
  | 'provider_error'
  | 'infra'
  | 'timeout'
  | 'validation_failure'
  | 'tool_misuse'
  | 'parse_error'
  | 'plan_error'
  | 'unknown';
```

- [ ] **Step 3: `runner.ts` — add the `let taskError` declaration** in the existing let-block at runner.ts:61-69:

```ts
    let harnessTaskId = '';
    let status: BenchmarkResult['status'] = 'failed';
    let taskError: string | undefined;
    // ... (existing: agentRun, diffs, traceFlow, traceSummary, evaluation, projectId, projectPath, promptVersion)
```

- [ ] **Step 4: Assign `taskError` inside the try** after `waitForTask` (runner.ts:99-100):

```ts
      status = finished.status === 'timeout' ? 'timeout' : (finished.status as BenchmarkResult['status']);
      taskError = finished.error;
```

- [ ] **Step 5: Add `taskError` to the `BenchmarkResult` construction** (runner.ts:139-152):

```ts
    const result: BenchmarkResult = {
      task,
      harnessTaskId,
      durationMs,
      status,
      taskError,
      evaluation,
      // ... rest unchanged
    };
```

- [ ] **Step 6: Message fallback + catch preference** (runner.ts:131-136):

After the try/catch, before the result construction, add:

```ts
    if (!evaluation.message && taskError) {
      evaluation = { ...evaluation, message: taskError };
    }
```

And in the catch block (runner.ts:131-136):

```ts
    } catch (err) {
      const thrownMessage = err instanceof Error ? err.message : String(err);
      evaluation = {
        passed: false,
        message: taskError && !taskError.startsWith('fetch failed') ? taskError : thrownMessage,
      };
    }
```

- [ ] **Step 7: Wrap the PATCH provider/model override** (runner.ts:91-95) in `withRetry`:

```ts
      if (!options.externalCli && (options.provider || options.model)) {
        await withRetry(() =>
          fetch(`${apiUrl}/tasks/${harnessTaskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: options.provider, model: options.model }),
          }),
        );
      }
```

(Add `withRetry` to the import from `./api-client.js` — it's exported from Task 1.1.)

- [ ] **Step 8: Verify typecheck** — `timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3` exits 0.

- [ ] **Step 9: No commit — continue to Task 1.3.**

### Task 1.3: Report + analyse — never blank, classify infra

**Files:**
- Modify: `packages/bench/src/report.ts`
- Modify: `packages/bench/src/analyse.ts`

- [ ] **Step 1: `report.ts` resultLine fallback** (report.ts:19):

```ts
  const msg = (r.evaluation.message || r.taskError) ? ` — ${r.evaluation.message || r.taskError}` : '';
```

- [ ] **Step 2: `analyse.ts` classifyFailure infra branch** — at the TOP of `classifyFailure` (analyse.ts:143, before the timeout branch):

```ts
  // Infra/provider/rate-limit failures surface in taskError (the server-side
  // task.error field) even when evaluation never produced a message.
  if (result.taskError) {
    const err = result.taskError;
    if (/rate|limit|quota|429/i.test(err)) {
      return withLog(result, { category: 'rate_limit', rootCause: 'Provider rate limit or quota exceeded.', evidence: [err.slice(0, 300)] });
    }
    if (/fetch failed|unreachable|ECONNRESET|provider.*error|infra/i.test(err)) {
      return withLog(result, { category: 'provider_error', rootCause: 'Provider or infra failure.', evidence: [err.slice(0, 300)] });
    }
  }
```

(Placement matters: it must run BEFORE the `EVIDENCE_RULES`/`matchEvidence` machinery at analyse.ts:143+ so `rate limit` evidence doesn't get absorbed by the existing `model_error` rule at analyse.ts:94-98.)

- [ ] **Step 3: Verify typecheck** — `timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3` exits 0.

- [ ] **Step 4: No commit — continue to Task 1.4.**

### Task 1.4: DeepSWE verifier timeout diagnostics

**Files:**
- Modify: `packages/bench/src/adapters/deepswe.ts`

- [ ] **Step 1: Extend `runCommand` return type + capture timeout** (deepswe.ts:853-884):

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

- [ ] **Step 2: Update the verifier return types + local path** — `runDeepSWEVerifierDocker` (1206), `runDeepSWEVerifierLocal` (1310), and the wrapper `runDeepSWEVerifier` (1265). All three return `Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number; timedOut: boolean }>`. In `runDeepSWEVerifierLocal`, key off the flag (deepswe.ts:1433-1448):

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

(In the Docker path, `runCommand`'s `timedOut` flows through the return; the wrapper's docker-validity fallback (deepswe.ts:1285-1293) is unchanged — a docker timeout falls back to a fresh local run, and the LOCAL run's `timedOut` is what surfaces.)

- [ ] **Step 3: `evaluate` surfaces the timeout** (deepswe.ts:1517-1547):

```ts
        const { reward, logs, logFile, exitCode, timedOut } = await runDeepSWEVerifier(
          ctx.projectPath,
          dir,
          commit,
          options.useDocker ?? false,
          id,
          storedPatch,
        );
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
        if (reward.apply_failed) {
          metrics.apply_failed = 1;
        }
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

Add a code comment in the docker wrapper noting: "a docker timeout → exitCode 1 → falls back to a fresh local run; verifier_timed_out only surfaces on the local path."

- [ ] **Step 4: Verify typecheck** — `timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3` exits 0.

- [ ] **Step 5: No commit — continue to Task 1.5.**

### Task 1.5: First unit tests for the bench package

**Files:**
- Create: `packages/bench/src/__tests__/api-client.test.ts`
- Create: `packages/bench/src/__tests__/runner.test.ts`

- [ ] **Step 1: Create `api-client.test.ts`** — tests `withRetry` + `waitForTask` transient-failure behavior. The functions are exported from `./api-client.js` (after Task 1.1, `withRetry` is exported; `waitForTask` takes the `consecutiveFailLimit` param). Use `vi.stubGlobal('fetch', ...)` to mock.

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitForTask, withRetry, ApiError } from '../api-client.js';

describe('waitForTask transient-failure resilience', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('survives a single transient fetch failure and returns the task status', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return { ok: true, status: 200, json: async () => ({ id: 't1', status: 'done' }) };
    }));
    const result = await waitForTask('http://x', 't1', 5000);
    expect(result.status).toBe('done');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('returns failed with a clear error after 3 consecutive failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      throw new TypeError('fetch failed');
    }));
    const result = await waitForTask('http://x', 't1', 5000, 3);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Server unreachable/);
  }, 20000);

  it('returns timeout when the task never finishes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
      ok: true, status: 200, json: async () => ({ id: 't1', status: 'in_progress' }),
    })));
    const result = await waitForTask('http://x', 't1', 1000);
    expect(result.status).toBe('timeout');
  });
});

describe('withRetry retry policy', () => {
  it('does not retry non-retryable 4xx errors (throws immediately, 1 call)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      return { ok: false, status: 400, json: async () => ({}) };
    }));
    await expect(withRetry(() => fetch('http://x'))).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('retries retryable 429 errors up to attempts', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const result = await withRetry(() => fetch('http://x'), { attempts: 3, baseDelayMs: 1 });
    expect(calls).toBe(3);
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Create `runner.test.ts`** — tests that `runBenchmark` captures `taskError` into the result. Mock `api-client.ts` functions via `vi.mock`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBenchmark } from '../runner.js';
import type { BenchmarkTask } from '../types.js';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  waitForTask: vi.fn(),
  getAgentRun: vi.fn(),
  getDiffs: vi.fn(),
  pollForDiffs: vi.fn(),
  getTraceFlow: vi.fn(),
  getTraceSummary: vi.fn(),
  getPromptVersion: vi.fn(),
  withRetry: vi.fn(),
  countSpans: vi.fn(() => 0),
}));

vi.mock('../api-client.js', () => ({
  ensureProject: mocks.ensureProject,
  createTask: mocks.createTask,
  runTask: mocks.runTask,
  waitForTask: mocks.waitForTask,
  getAgentRun: mocks.getAgentRun,
  getDiffs: mocks.getDiffs,
  pollForDiffs: mocks.pollForDiffs,
  getTraceFlow: mocks.getTraceFlow,
  getTraceSummary: mocks.getTraceSummary,
  getPromptVersion: mocks.getPromptVersion,
  withRetry: mocks.withRetry,
  countSpans: mocks.countSpans,
}));

const makeTask = (): BenchmarkTask => ({
  id: 't1',
  name: 'test-task',
  title: 'Test task',
  description: 'desc',
  complexity: 'simple',
  tags: [],
  evaluate: vi.fn().mockResolvedValue({ passed: false, message: '' }),
});

describe('runBenchmark taskError capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Route runtime dirs to a temp dir so tests don't pollute ~/.omega
    // (runBenchmark calls omegaWorkDir() + ensureGitRepo which create real dirs).
    process.env.OMEGA_STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
    mocks.ensureProject.mockResolvedValue({ id: 'p1' });
    mocks.createTask.mockResolvedValue({ id: 'ht1', status: 'todo' });
    mocks.runTask.mockResolvedValue(undefined);
    mocks.getAgentRun.mockResolvedValue(undefined);
    mocks.getDiffs.mockResolvedValue([]);
    mocks.pollForDiffs.mockResolvedValue([]);
    mocks.getTraceFlow.mockResolvedValue(undefined);
    mocks.getTraceSummary.mockResolvedValue(undefined);
    mocks.getPromptVersion.mockResolvedValue(undefined);
    mocks.withRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  });

  it('captures taskError from waitForTask when the task failed with an error', async () => {
    mocks.waitForTask.mockResolvedValue({ status: 'failed', error: 'provider crashed' });
    const report = await runBenchmark([makeTask()], { apiUrl: 'http://x', suiteName: 'fast' });
    expect(report.results[0]?.status).toBe('failed');
    expect(report.results[0]?.taskError).toBe('provider crashed');
    // The empty evaluation.message falls back to taskError:
    expect(report.results[0]?.evaluation.message).toBe('provider crashed');
  });

  it('uses taskError in the report line (via resultLine)', async () => {
    mocks.waitForTask.mockResolvedValue({ status: 'failed', error: 'rate limited' });
    const report = await runBenchmark([makeTask()], { apiUrl: 'http://x', suiteName: 'fast' });
    expect(report.results[0]?.evaluation.message).toBe('rate limited');
  });

  it('prefers taskError over a thrown evaluate error when it carries a server-side reason', async () => {
    mocks.waitForTask.mockResolvedValue({ status: 'failed', error: 'provider crashed' });
    const task = makeTask();
    task.evaluate = vi.fn().mockRejectedValue(new Error('evaluate exploded'));
    const report = await runBenchmark([task], { apiUrl: 'http://x', suiteName: 'fast' });
    expect(report.results[0]?.evaluation.message).toBe('provider crashed');
  });
});
```

- [ ] **Step 3: Run the tests** — `timeout 120 pnpm --filter @omega/bench test 2>&1 | tail -15`. Expected: all pass.

- [ ] **Step 4: No commit — continue to Task 1.6.**

### Task 1.6: Verify Chunk 1 builds + all tests pass

**Behavior-change note for downstream callers:** `waitForTask` no longer rejects on a transient fetch failure — it resolves `{ status: 'failed', error: 'Server unreachable...' }` after 3 consecutive failed polls. `consensus.ts:283` and `strategy-eval.ts:293` previously relied on `Promise.all` rejecting on fetch failure; they now see a `failed` status instead. Both already map `failed` (consensus.ts:284), so this is compatible — but verify their tests still pass in Task 1.6 Step 2 (run the full bench suite, not just the new test files).

- [ ] **Step 1: All package builds pass**

```bash
timeout 120 pnpm --filter @omega/bench build 2>&1 | tail -3
timeout 120 pnpm --filter @omega/server build 2>&1 | tail -3
timeout 120 pnpm --filter @omega/agent build 2>&1 | tail -3
timeout 120 pnpm --filter @omega/cli build 2>&1 | tail -3
timeout 120 pnpm --filter @omega/web build 2>&1 | tail -3
```

Expected: all exit 0. (The `@omega/bench` package is a dependency of `@omega/server` via `run-task.ts` imports — verify no type breakage flows through.)

- [ ] **Step 2: Bench tests pass**

```bash
timeout 120 pnpm --filter @omega/bench test 2>&1 | tail -15
```

Expected: the 9 new tests (6 api-client + 3 runner) pass. Note: this runs the FULL bench test suite (including any existing tests in `consensus.ts`/`strategy-eval.ts` — verify the `waitForTask` behavior-change didn't break them).

- [ ] **Step 3: Agent + server tests still pass**

```bash
timeout 90 pnpm --filter @omega/agent test 2>&1 | tail -5
timeout 90 pnpm --filter @omega/server test 2>&1 | tail -8
```

Expected: agent tests pass (all files — external.test.ts, codex-driver.test.ts, etc.) + server tests pass (app.test.ts + retry-strategies.test.ts).

- [ ] **Step 4: Smoke test the server still serves** — `lsof -nP -iTCP:4000 -sTCP:LISTEN | tail -1` shows the running server; `curl -s http://127.0.0.1:4000/ | head -1` returns the HTML.

- [ ] **Step 5: Commit (DO NOT auto-commit — request user approval first).** If approved:

```bash
git add packages/bench/src/api-client.ts packages/bench/src/runner.ts packages/bench/src/types.ts packages/bench/src/report.ts packages/bench/src/analyse.ts packages/bench/src/adapters/deepswe.ts packages/bench/src/__tests__/api-client.test.ts packages/bench/src/__tests__/runner.test.ts
git commit -m "feat(bench): benchmark reliability — retry infra calls, surface task errors, verifier timeout diagnostics"
```
