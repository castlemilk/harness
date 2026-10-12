import { describe, expect, it, vi } from 'vitest';
import {
  delay,
  ExecutionAbortedError,
  ExecutionLoopTimeoutError,
  isTerminalTaskStatus,
  waitForTaskTerminal,
} from './execution-loop.js';

function clientReturning(statuses: string[]) {
  let call = 0;
  const getTask = vi.fn(async () => {
    const status = statuses[Math.min(call, statuses.length - 1)] ?? 'done';
    call += 1;
    return { id: 'task-1', status };
  });
  return { getTask };
}

/** Deterministic clock: sleep advances it instead of blocking. */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe('isTerminalTaskStatus', () => {
  it('treats only done/failed/cancelled as terminal', () => {
    for (const s of ['done', 'failed', 'cancelled']) {
      expect(isTerminalTaskStatus(s)).toBe(true);
    }
    for (const s of ['todo', 'in_progress', 'running', 'pending', 'waiting', 'unknown', '']) {
      expect(isTerminalTaskStatus(s)).toBe(false);
    }
  });

  it('rejects non-string statuses without throwing', () => {
    expect(isTerminalTaskStatus(undefined)).toBe(false);
    expect(isTerminalTaskStatus(null)).toBe(false);
    expect(isTerminalTaskStatus(42)).toBe(false);
  });
});

describe('waitForTaskTerminal', () => {
  it('returns immediately when the task is already terminal', async () => {
    const client = clientReturning(['done']);
    const clock = fakeClock();
    const result = await waitForTaskTerminal(client, 'task-1', clock);
    expect(result.task.status).toBe('done');
    expect(result.polls).toBe(1);
    expect(result.elapsedMs).toBe(0);
    expect(client.getTask).toHaveBeenCalledTimes(1);
  });

  it('polls until the task reaches a terminal status', async () => {
    const client = clientReturning(['in_progress', 'in_progress', 'done']);
    const clock = fakeClock();
    const result = await waitForTaskTerminal(client, 'task-1', {
      ...clock,
      pollIntervalMs: 100,
      timeoutMs: 10_000,
    });
    expect(result.task.status).toBe('done');
    expect(result.polls).toBe(3);
    expect(result.elapsedMs).toBe(200);
  });

  it('returns the terminal task snapshot for a failure', async () => {
    const client = clientReturning(['in_progress', 'failed']);
    const clock = fakeClock();
    const result = await waitForTaskTerminal(client, 'task-1', { ...clock, pollIntervalMs: 50 });
    expect(result.task.status).toBe('failed');
  });

  it('times out with the last observed status and never sleeps past the deadline', async () => {
    const client = clientReturning(['in_progress']);
    const clock = fakeClock();
    await expect(
      waitForTaskTerminal(client, 'task-1', { ...clock, pollIntervalMs: 1_000, timeoutMs: 2_500 })
    ).rejects.toBeInstanceOf(ExecutionLoopTimeoutError);
    // 2500ms budget at 1000ms intervals: polls at 0, 1000, 2000 then the sleep
    // is clamped to the 500ms left, so elapsed cannot exceed the budget.
    expect(clock.now()).toBeLessThanOrEqual(2_500);
  });

  it('reports a zero timeout as an immediate timeout rather than looping', async () => {
    const client = clientReturning(['in_progress']);
    const clock = fakeClock();
    await expect(waitForTaskTerminal(client, 'task-1', { ...clock, timeoutMs: 0 })).rejects.toThrow(
      /did not reach a terminal state/
    );
  });

  it('propagates an abort signal instead of polling forever', async () => {
    const controller = new AbortController();
    const client = clientReturning(['in_progress']);
    const clock = fakeClock();
    const pending = waitForTaskTerminal(client, 'task-1', { ...clock, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ExecutionAbortedError);
  });

  it('rejects an already-aborted signal without calling the API', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = clientReturning(['done']);
    await expect(
      waitForTaskTerminal(client, 'task-1', { ...fakeClock(), signal: controller.signal })
    ).rejects.toBeInstanceOf(ExecutionAbortedError);
    expect(client.getTask).not.toHaveBeenCalled();
  });

  it('requires a taskId', async () => {
    const client = clientReturning(['done']);
    await expect(waitForTaskTerminal(client, '')).rejects.toThrow(/requires a taskId/);
  });

  it('surfaces API errors rather than spinning', async () => {
    const getTask = vi.fn(async () => {
      throw new Error('Task not found');
    });
    await expect(waitForTaskTerminal({ getTask }, 'task-1', fakeClock())).rejects.toThrow('Task not found');
    expect(getTask).toHaveBeenCalledTimes(1);
  });
});

describe('delay', () => {
  it('resolves after the interval', async () => {
    const started = Date.now();
    await delay(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('rejects when the signal aborts and does not leave the timer pending', async () => {
    const controller = new AbortController();
    const pending = delay(5_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(5_000, controller.signal)).rejects.toThrow('aborted');
  });
});