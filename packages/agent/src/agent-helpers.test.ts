import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
    projectPath: '/tmp',
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
      thinking: false,
    }));
  });

  it('applies a grounded patch with offset hunk lines', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-stuck-solve-'));
    try {
      await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
      await fs.writeFile(path.join(projectPath, 'src/example.ts'), 'prefix\nold\n', 'utf-8');
      const send = vi.fn().mockResolvedValue(
        'diff --git a/src/example.ts b/src/example.ts\n' +
        '--- a/src/example.ts\n' +
        '+++ b/src/example.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-old\n' +
        '+new\n'
      );
      const ctx = context({ config: { name: 'test' }, send } as unknown as Provider, Date.now() + 120_000, []);
      ctx.projectPath = projectPath;

      await expect(tryStuckSolve(ctx)).resolves.toBe(true);
      await expect(fs.readFile(path.join(projectPath, 'src/example.ts'), 'utf-8')).resolves.toBe('prefix\nnew\n');
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true });
    }
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
