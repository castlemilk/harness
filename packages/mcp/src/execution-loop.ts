import type { HarnessApiClient } from './api-client.js';

/**
 * Runtime execution loop for MCP tool calls.
 *
 * `POST /v1/tasks/:id/run` is fire-and-forget: it hands the task to the queue
 * (or to a cuttlefish flow) and returns immediately. A client that wants the
 * outcome has to poll by hand. This module is that poll, bounded by a deadline
 * so a stuck run reports a clear timeout instead of hanging the tool call
 * forever.
 */

/** Statuses a task cannot leave. Anything else means "still going". */
export const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled']);

export interface TaskSnapshot {
  status: string;
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface WaitForTaskOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injectable clock and sleep so tests do not wait in real time. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface WaitForTaskResult {
  task: TaskSnapshot;
  polls: number;
  elapsedMs: number;
}

export class ExecutionLoopTimeoutError extends Error {
  readonly taskId: string;
  readonly lastStatus: string | undefined;
  readonly elapsedMs: number;

  constructor(taskId: string, lastStatus: string | undefined, elapsedMs: number) {
    super(
      `Task ${taskId} did not reach a terminal state within ${String(Math.round(elapsedMs / 1000))}s ` +
        `(last status: ${lastStatus ?? 'unknown'}). It may still be running; query omega_task_get later.`
    );
    this.name = 'ExecutionLoopTimeoutError';
    this.taskId = taskId;
    this.lastStatus = lastStatus;
    this.elapsedMs = elapsedMs;
  }
}

export class ExecutionAbortedError extends Error {
  constructor(taskId: string) {
    super(`Execution loop for task ${taskId} was aborted`);
    this.name = 'ExecutionAbortedError';
  }
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 900_000; // 15 minutes

export function isTerminalTaskStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_TASK_STATUSES.has(status);
}

function abortError(taskId: string): Error {
  return new ExecutionAbortedError(taskId);
}

/** Sleep that clears its timer and listener on both settle paths. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new Error('aborted'));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Polls a task until it reaches a terminal status.
 *
 * Checks at least once before sleeping, so a task that finished during dispatch
 * returns without paying a poll interval.
 */
export async function waitForTaskTerminal(
  client: Pick<HarnessApiClient, 'getTask'>,
  taskId: string,
  options: WaitForTaskOptions = {}
): Promise<WaitForTaskResult> {
  if (!taskId) throw new Error('waitForTaskTerminal requires a taskId');

  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const startedAt = now();
  let polls = 0;
  let lastStatus: string | undefined;

  for (;;) {
    if (options.signal?.aborted) throw abortError(taskId);

// The API can answer with an empty body; treat that as "not terminal yet" and
    // keep polling rather than throwing on property access.
    const task = (await client.getTask(taskId)) as TaskSnapshot | null | undefined;
    polls += 1;
    lastStatus = typeof task?.status === 'string' ? task.status : undefined;

    if (task !== null && task !== undefined && lastStatus !== undefined && isTerminalTaskStatus(lastStatus)) {
      return { task, polls, elapsedMs: now() - startedAt };
    }

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new ExecutionLoopTimeoutError(taskId, lastStatus, elapsed);
    }

    // Never sleep past the deadline, so the timeout error lands on time.
    const remaining = timeoutMs - elapsed;
    await sleep(Math.min(pollIntervalMs, remaining), options.signal).catch(() => {
      throw abortError(taskId);
    });
  }
}