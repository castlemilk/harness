import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';

const mocks = vi.hoisted(() => ({
  runExternalAgentTask: vi.fn(),
  runAgentTask: vi.fn(),
  runOrchestratedTask: vi.fn(),
  getRouter: vi.fn(),
  recordTaskOutcome: vi.fn(),
  notifyFailure: vi.fn(),
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

vi.mock('./webhook-alerts.js', () => ({
  notifyFailure: mocks.notifyFailure,
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

function makePrisma(task: { id: string; [key: string]: unknown }): PrismaClient {
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
    mocks.notifyFailure.mockResolvedValue(undefined);
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
    const controller = new AbortController();

    await runTask(prisma, 'task-1', { signal: controller.signal });

    expect(health.isCircuitBroken).toHaveBeenCalledWith('external:codex');
    expect(mocks.runExternalAgentTask).toHaveBeenCalledWith(
      prisma,
      'task-1',
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(health.record).toHaveBeenCalledWith('external:codex', expect.objectContaining({ success: true }));
    expect(performance.update).toHaveBeenCalledWith('external:codex/gpt-5.6-luna', true, 0, expect.any(Number));
    expect(health.record).not.toHaveBeenCalledWith('codex', expect.anything());
  });

  it('threads the benchmark wall-clock timeout into the internal agent executor', async () => {
    const task = {
      ...makeTask('codex', 'internal-model'),
      title: 'Internal task',
      tags: JSON.stringify(['agent']),
      provider: 'internal-provider',
    };
    const router = { health: { record: vi.fn() }, performance: { update: vi.fn() } };
    mocks.getRouter.mockResolvedValue(router);
    mocks.runAgentTask.mockResolvedValue({ task: { ...task, status: 'done' }, agentRunId: 'run-1' });
    const prisma = {
      ...makePrisma(task),
      providerConfig: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const controller = new AbortController();

    await runTask(prisma, task.id, { timeoutMs: 1_200_000, signal: controller.signal });

    expect(mocks.runAgentTask).toHaveBeenCalledWith(
      prisma,
      task.id,
      expect.objectContaining({ timeoutMs: 1_200_000, signal: controller.signal }),
      router,
    );
  });

  it('threads caller cancellation into the orchestrated agent executor', async () => {
    const task = {
      ...makeTask('codex', 'internal-model'),
      title: 'Orchestrated task',
      tags: JSON.stringify(['agent', 'orchestrate']),
      provider: 'internal-provider',
    };
    const router = { health: { record: vi.fn() }, performance: { update: vi.fn() } };
    mocks.getRouter.mockResolvedValue(router);
    mocks.runOrchestratedTask.mockResolvedValue({
      task: { ...task, status: 'done' },
      agentRunId: 'run-1',
    });
    const prisma = {
      ...makePrisma(task),
      providerConfig: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const controller = new AbortController();

    await runTask(prisma, task.id, { signal: controller.signal });

    expect(mocks.runOrchestratedTask).toHaveBeenCalledWith(
      prisma,
      task.id,
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('does not eagerly pin an unassigned orchestrated parent', async () => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    const task = {
      ...makeTask('codex', 'internal-model'),
      title: 'Tiered orchestration task',
      tags: JSON.stringify(['agent', 'orchestrate']),
      provider: null,
      model: null,
      createdAt: now,
      updatedAt: now,
    };
    const router = {};
    mocks.getRouter.mockResolvedValue(router);
    mocks.runOrchestratedTask.mockResolvedValue({
      task: { ...task, status: 'done', createdAt: now, updatedAt: now },
      agentRunId: 'run-1',
    });
    const prisma = {
      ...makePrisma(task),
      providerConfig: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    await runTask(prisma, task.id);

    expect(mocks.runOrchestratedTask).toHaveBeenCalledWith(
      prisma,
      task.id,
      expect.objectContaining({ intelligentRouter: router }),
    );
    expect(prisma.task.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provider: expect.any(String), model: expect.any(String) }),
    }));
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
    const performance = { update: vi.fn() };
    mocks.getRouter.mockResolvedValue({ health, performance });
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

  it('does not start an automatic retry after caller cancellation', async () => {
    const health = {
      isCircuitBroken: vi.fn().mockReturnValue(false),
      record: vi.fn(),
    };
    const performance = { update: vi.fn() };
    mocks.getRouter.mockResolvedValue({ health, performance });
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
        executionSucceeded: false,
      };
    });
    const controller = new AbortController();
    controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));

    await runTask(prisma, state.id, { signal: controller.signal });

    expect(state.retryHistory).toBeNull();
    expect(mocks.runExternalAgentTask).toHaveBeenCalledTimes(1);
    expect(mocks.notifyFailure).not.toHaveBeenCalled();
    expect(health.record).not.toHaveBeenCalled();
    expect(performance.update).not.toHaveBeenCalled();
  });

  it('does not record an internal cancellation as model health or page operators', async () => {
    const task = {
      ...makeTask('codex', 'internal-model'),
      title: 'Internal task',
      tags: JSON.stringify(['agent']),
      provider: 'internal-provider',
    };
    const router = { health: { record: vi.fn() }, performance: { update: vi.fn() } };
    mocks.getRouter.mockResolvedValue(router);
    mocks.runAgentTask.mockResolvedValue({
      task: {
        ...task,
        status: 'failed',
        error: 'Benchmark cancelled',
        result: 'Benchmark cancelled',
      },
      agentRunId: 'run-1',
    });
    const prisma = {
      ...makePrisma(task),
      providerConfig: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const controller = new AbortController();
    controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));

    await runTask(prisma, task.id, { signal: controller.signal });

    expect(mocks.recordTaskOutcome).not.toHaveBeenCalled();
    expect(mocks.notifyFailure).not.toHaveBeenCalled();
  });
});
