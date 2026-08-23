import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';

const mocks = vi.hoisted(() => ({
  runExternalAgentTask: vi.fn(),
  runAgentTask: vi.fn(),
  runOrchestratedTask: vi.fn(),
  getRouter: vi.fn(),
  recordTaskOutcome: vi.fn(),
}));

vi.mock('@omega/agent', () => ({
  runExternalAgentTask: mocks.runExternalAgentTask,
  runAgentTask: mocks.runAgentTask,
  runOrchestratedTask: mocks.runOrchestratedTask,
}));

vi.mock('./intelligent-router.js', () => ({
  getRouter: mocks.getRouter,
  recordTaskOutcome: mocks.recordTaskOutcome,
}));

import { runTask } from './run-task.js';

function makeTask(cli: 'codex' | 'opencode', model: string) {
  const now = new Date('2026-08-23T00:00:00.000Z');
  return {
    id: 'task-1',
    projectId: 'project-1',
    project: { id: 'project-1', name: 'project', path: '/tmp/project' },
    title: 'External task',
    description: 'Implement it',
    status: 'todo',
    complexity: 'simple',
    tags: JSON.stringify(['agent', `external:${cli}`]),
    provider: `external:${cli}`,
    model,
    result: null,
    error: null,
    retryCount: 0,
    retryHistory: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makePrisma(task: ReturnType<typeof makeTask>): PrismaClient {
  return {
    task: {
      findUnique: vi.fn().mockResolvedValue(task),
      update: vi.fn().mockResolvedValue(task),
    },
    agentRun: {
      findFirst: vi.fn().mockResolvedValue({ costUsd: 0 }),
    },
    taskTrace: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('external task circuit routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OMEGA_AUTO_RETRY;
  });

  it('uses distinct health/performance key spaces for every external outcome', async () => {
    const health = {
      isCircuitBroken: vi.fn().mockReturnValue(false),
      record: vi.fn(),
    };
    const performance = { update: vi.fn() };
    mocks.getRouter.mockResolvedValue({ health, performance });
    mocks.runExternalAgentTask.mockResolvedValue({
      status: 'done',
      diff: 'diff --git a/a b/a',
      output: 'done',
      executionSucceeded: true,
    });
    const prisma = makePrisma(makeTask('codex', 'gpt-5.6-luna'));

    await runTask(prisma, 'task-1');

    expect(health.isCircuitBroken).toHaveBeenCalledWith('external:codex');
    expect(health.record).toHaveBeenCalledWith('external:codex', expect.objectContaining({ success: true }));
    expect(performance.update).toHaveBeenCalledWith('external:codex/gpt-5.6-luna', true, 0, expect.any(Number));
    expect(health.record).not.toHaveBeenCalledWith('codex', expect.anything());
  });

  it('does not fail a completed CLI run when router telemetry throws', async () => {
    const health = {
      isCircuitBroken: vi.fn().mockReturnValue(false),
      record: vi.fn().mockImplementation(() => { throw new Error('health storage unavailable'); }),
    };
    const performance = {
      update: vi.fn().mockImplementation(() => { throw new Error('performance storage unavailable'); }),
    };
    mocks.getRouter.mockResolvedValue({ health, performance });
    mocks.runExternalAgentTask.mockResolvedValue({
      status: 'done',
      diff: 'diff --git a/a b/a',
      output: 'done',
      executionSucceeded: true,
    });

    await expect(runTask(makePrisma(makeTask('codex', 'gpt-5.6-luna')), 'task-1'))
      .resolves.toEqual(expect.objectContaining({ status: 'done' }));
  });

  it('fails fast with a disclosed open-circuit reason without starting the CLI', async () => {
    const health = {
      isCircuitBroken: vi.fn().mockReturnValue(true),
      record: vi.fn(),
    };
    const performance = { update: vi.fn() };
    mocks.getRouter.mockResolvedValue({ health, performance });
    const task = makeTask('opencode', 'openrouter/test-model');
    const prisma = makePrisma(task);

    const result = await runTask(prisma, task.id);

    expect(mocks.runExternalAgentTask).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: 'failed' }));
    expect(result).toEqual(expect.objectContaining({ output: expect.stringMatching(/external:opencode.*circuit.*open/i) }));
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: task.id },
      data: expect.objectContaining({
        status: 'failed',
        error: expect.stringMatching(/external:opencode.*circuit.*open/i),
        result: expect.stringMatching(/external:opencode.*circuit.*open/i),
      }),
    });
    expect(health.record).not.toHaveBeenCalled();
    expect(performance.update).not.toHaveBeenCalled();
  });

  it('audits a terminal classification and does not automatically retry it', async () => {
    const health = {
      isCircuitBroken: vi.fn().mockReturnValue(false),
      record: vi.fn(),
    };
    mocks.getRouter.mockResolvedValue({ health, performance: { update: vi.fn() } });
    const state = makeTask('opencode', 'openrouter/test-model');
    const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state, data);
      return state;
    });
    const prisma = {
      task: {
        findUnique: vi.fn().mockImplementation(async () => state),
        update,
      },
      agentRun: {
        findFirst: vi.fn().mockResolvedValue({ costUsd: 0 }),
      },
      taskTrace: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;
    mocks.runExternalAgentTask.mockImplementation(async () => {
      Object.assign(state, {
        status: 'failed',
        error: 'External agent (opencode) produced no changes',
        result: 'External agent (opencode) produced no changes',
      });
      return {
        status: 'failed',
        diff: '',
        output: 'External agent (opencode) produced no changes',
        executionSucceeded: true,
      };
    });

    await runTask(prisma, state.id);

    const history = JSON.parse(state.retryHistory ?? '[]') as Record<string, unknown>[];
    expect(history.at(-1)).toEqual(expect.objectContaining({
      strategy: 'auto-retry-skipped',
      classification: 'terminal',
      category: 'agent-result',
      decision: 'skipped',
    }));
    expect(state.status).toBe('failed');
    expect(mocks.runExternalAgentTask).toHaveBeenCalledTimes(1);
  });
});
