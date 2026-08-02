import type { AgentRunInfo, DiffInfo, TraceFlowInfo, TraceSummary } from './types.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERR = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|UND_ERR/i;

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (attempts < 1) throw new Error('withRetry: attempts must be >= 1');
  for (let i = 0; i < attempts; i++) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          fn(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Request timed out after ${String(timeoutMs)}ms`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err instanceof ApiError ? err.status : 0;
      const retryable = RETRYABLE_STATUS.has(status) || RETRYABLE_ERR.test(msg) || msg.includes('timed out');
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw new Error('withRetry: unreachable');
}

// Idempotency note: createTask/runTask are not strictly idempotent. If a
// transport failure hides a SUCCESSFUL start (server accepted, task ->
// in_progress), the retried POST /run hits the server's already-running check
// (throws `Task ... is already in progress`, route returns 500), burns the
// backoff attempts, then throws `POST ... -> 500`. The task keeps running
// server-side; the bench reports a failure for this run. Acceptable +
// documented — the recovery is to re-run the bench task.

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${url} -> ${String(res.status)}`);
  }
  return res.json() as Promise<T>;
}

export async function ensureProject(
  apiUrl: string,
  name: string,
  path: string
): Promise<{ id: string }> {
  return withRetry(
    async () => {
      const res = await fetch(`${apiUrl}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path }),
      });
      if (res.status === 409) {
        // Project path already exists; fetch by path.
        const projects = (await fetch(`${apiUrl}/projects?path=${encodeURIComponent(path)}`).then((r) =>
          r.json()
        )) as { id: string; path: string }[];
        const existing = projects.find((p) => p.path === path);
        if (existing) return existing;
        throw new ApiError(res.status, `create project failed: 409`);
      }
      if (!res.ok) throw new ApiError(res.status, `create project failed: ${String(res.status)}`);
      return res.json() as Promise<{ id: string }>;
    },
    { timeoutMs: 10_000 }
  );
}

export async function createTask(
  apiUrl: string,
  projectId: string,
  title: string,
  options: { description?: string; complexity?: string; tags?: string[] } = {}
): Promise<{ id: string; status: string }> {
  return withRetry(
    () =>
      apiFetch(`${apiUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title,
          description: options.description,
          complexity: options.complexity ?? 'simple',
          tags: options.tags ?? ['benchmark'],
        }),
      }),
    { timeoutMs: 10_000 }
  );
}

export async function runTask(apiUrl: string, taskId: string, tokenBudget?: number): Promise<void> {
  await withRetry(
    () =>
      apiFetch(`${apiUrl}/tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenBudget }),
      }),
    { timeoutMs: 10_000 }
  );
}

export async function getTask(apiUrl: string, taskId: string): Promise<{ status: string; result?: string; error?: string }> {
  // Assumption: a 404 here is NOT retryable. POST /run is synchronous — the
  // server marks the task in_progress (and errors on a missing task) before
  // responding 202, so by the time we poll, a 404 means the task truly does
  // not exist (e.g. deleted server-side); retrying cannot recover it.
  return apiFetch(`${apiUrl}/tasks/${taskId}`);
}

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
      const task = await withRetry(() => getTask(apiUrl, taskId), { timeoutMs: 10_000 });
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

export async function getAgentRun(apiUrl: string, taskId: string): Promise<AgentRunInfo | undefined> {
  try {
    return await apiFetch<AgentRunInfo>(`${apiUrl}/tasks/${taskId}/agent-run`);
  } catch (err) {
    console.warn(`getAgentRun(${taskId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export async function getDiffs(apiUrl: string, taskId: string): Promise<DiffInfo[]> {
  try {
    return await apiFetch<DiffInfo[]>(`${apiUrl}/tasks/${taskId}/diffs`);
  } catch (err) {
    // 404 during the post-timeout grace window is expected (the task is still
    // finishing and has no diffs row yet); don't spam warns from pollForDiffs.
    if (!(err instanceof ApiError && err.status === 404)) {
      console.warn(`getDiffs(${taskId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }
}

export async function pollForDiffs(
  apiUrl: string,
  taskId: string,
  graceMs = 180_000,
  pollIntervalMs = 2_000
): Promise<DiffInfo[]> {
  // After a bench timeout, the agent may still be finishing its final steps and
  // committing the model.patch to the taskDiff table. Poll for up to graceMs
  // so we capture late-arriving diffs and feed them to the verifier.
  const deadline = Date.now() + graceMs;
  let last: DiffInfo[] = [];
  while (Date.now() < deadline) {
    last = await getDiffs(apiUrl, taskId);
    if (last.length > 0) return last;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return last;
}

export async function getTraceFlow(apiUrl: string, taskId: string): Promise<TraceFlowInfo | undefined> {
  try {
    return await apiFetch<TraceFlowInfo>(`${apiUrl}/tasks/${taskId}/trace-flow`);
  } catch (err) {
    console.warn(`getTraceFlow(${taskId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export async function getTraceSummary(apiUrl: string, taskId: string): Promise<TraceSummary | undefined> {
  try {
    return await apiFetch<TraceSummary>(`${apiUrl}/tasks/${taskId}/trace-analysis`);
  } catch (err) {
    console.warn(`getTraceSummary(${taskId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export async function getPromptVersion(
  apiUrl: string,
  id: string
): Promise<{ id: string; hash: string; name: string } | undefined> {
  try {
    return await apiFetch<{ id: string; hash: string; name: string }>(`${apiUrl}/prompt-versions/${id}`);
  } catch (err) {
    console.warn(`getPromptVersion(${id}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export function countSpans(node: { children?: unknown[] }): number {
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countSpans(child as { children?: unknown[] });
    }
  }
  return count;
}
