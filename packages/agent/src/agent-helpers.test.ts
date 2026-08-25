import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import type { Provider } from '@omega/core';
import type { AgentContext } from './agent-types.js';
import { reflectOnTrace, tryStuckSolve } from './agent-helpers.js';

function context(provider: Provider, deadlineMs: number, traces: { role: string; content: string }[]): AgentContext {
  const span = {
    addEvent: vi.fn(),
    recordError: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    toContext: vi.fn().mockReturnValue({}),
  };
  const prisma = {
    taskTrace: { findMany: vi.fn().mockResolvedValue(traces) },
  } as unknown as PrismaClient;
  return {
    prisma,
    provider,
    model: 'test-model',
    deadlineMs,
    task: { id: 'task-1', title: 'Test task', description: null },
    tracer: { startSpan: vi.fn().mockReturnValue(span) },
    rootSpan: span,
    usage: {},
  } as unknown as AgentContext;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent helper request timeout', () => {
  it('caps the stuck-solver request at 120 seconds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const send = vi.fn().mockResolvedValue('no patch');
    const ctx = context({ config: { name: 'test' }, send } as unknown as Provider, 2_600_000, []);

    await expect(tryStuckSolve(ctx)).resolves.toBe(false);
    expect(send).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      timeoutMs: 120_000,
    }));
  });

  it('gives the near-deadline reflection request a five second floor', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const send = vi.fn().mockResolvedValue('use a smaller change');
    const ctx = context(
      { config: { name: 'test' }, send } as unknown as Provider,
      2_001_000,
      [{ role: 'assistant', content: 'trace' }],
    );

    await expect(reflectOnTrace(ctx, 1)).resolves.toBe('use a smaller change');
    expect(send).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      timeoutMs: 5_000,
    }));
  });
});
