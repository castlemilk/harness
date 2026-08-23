import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@omega/db';
const mocks = vi.hoisted(() => ({
  runRoutedExternalAgentTask: vi.fn(),
  notifyFailure: vi.fn(),
  notifyRetry: vi.fn(),
}));

vi.mock('./external-agent-runner.js', () => ({
  runRoutedExternalAgentTask: mocks.runRoutedExternalAgentTask,
}));

vi.mock('./webhook-alerts.js', () => ({
  notifyFailure: mocks.notifyFailure,
  notifyRetry: mocks.notifyRetry,
}));

import { executeRetry, getNextStrategy, type RetryContext } from './retry-strategies.js';
import * as retryStrategies from './retry-strategies.js';

function makePrismaMock(opts: {
  providers?: { kind: string; enabled: boolean; defaultModel: string; capabilities: unknown }[];
}): PrismaClient {
  return {
    providerConfig: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { kind: string } }) => {
        return opts.providers?.find((p) => p.kind === where.kind) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where?: { enabled?: boolean; kind?: { not?: string } } }) => {
        let result = opts.providers ?? [];
        if (where?.enabled === true) result = result.filter((p) => p.enabled);
        const excluded = where?.kind?.not;
        if (excluded != null) result = result.filter((p) => p.kind !== excluded);
        return result;
      }),
    },
  } as unknown as PrismaClient;
}

function makeCtx(
  overrides: Partial<RetryContext['task']> = {},
  prisma: PrismaClient = makePrismaMock({}),
): RetryContext {
  return {
    task: {
      id: 'task-1',
      projectId: 'proj-1',
      title: 'Test',
      description: null,
      complexity: 'simple',
      tags: [],
      provider: 'qwen',
      model: 'qwen-small',
      retryCount: 1,
      retryHistory: [],
      ...overrides,
    },
    projectPath: '/tmp',
    projectName: 'project',
    error: 'build timed out',
    prisma,
  };
}

describe('getNextStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tier-escalation returns a concrete model from the configured ladder', async () => {
    const prisma = makePrismaMock({
      providers: [
        {
          kind: 'qwen',
          enabled: true,
          defaultModel: 'qwen-small',
          capabilities: { modelTiers: { 'qwen-small': 'qwen-large' } },
        },
      ],
    });
    const ctx = makeCtx({ retryCount: 1, provider: 'qwen', model: 'qwen-small' }, prisma);
    const attempt = await getNextStrategy(ctx);
    expect(attempt).toBeDefined();
    expect(attempt?.strategy).toBe('tier-escalation');
    expect(attempt?.provider).toBe('qwen');
    expect(attempt?.model).toBe('qwen-large');
  });

  it('different-provider returns a different ProviderConfig row', async () => {
    const prisma = makePrismaMock({
      providers: [
        { kind: 'qwen', enabled: true, defaultModel: 'qwen-large', capabilities: {} },
        { kind: 'deepseek', enabled: true, defaultModel: 'deepseek-default', capabilities: {} },
        { kind: 'kimi', enabled: true, defaultModel: 'kimi-default', capabilities: {} },
      ],
    });
    const ctx = makeCtx({ provider: 'qwen', model: 'qwen-large', retryCount: 1 }, prisma);
    const attempt = await getNextStrategy(ctx);
    expect(attempt).toBeDefined();
    expect(attempt?.strategy).toBe('different-provider');
    expect(attempt?.provider).not.toBe('qwen');
    expect(['deepseek', 'kimi']).toContain(attempt?.provider);
    expect(attempt?.model).toMatch(/default$/);
  });

  it('keeps the original external CLI on the clean transient retry', async () => {
    const attempt = await getNextStrategy(makeCtx({
      retryCount: 0,
      tags: ['external:opencode'],
      provider: 'external:opencode',
      model: 'openrouter/test-model',
    }));

    expect(attempt).toEqual(expect.objectContaining({
      strategy: 'clean-retry',
      cli: 'opencode',
      model: 'openrouter/test-model',
    }));
  });

  it('classifies only infrastructure failures as transient and gives validation precedence', () => {
    const classify = (retryStrategies as unknown as {
      classifyRetryFailure?: (error: string) => { classification: string; category: string };
    }).classifyRetryFailure;
    expect(classify).toBeTypeOf('function');
    if (!classify) return;

    expect(classify('HTTP 429 rate limit exceeded')).toEqual(expect.objectContaining({
      classification: 'transient',
      category: 'rate-limit',
    }));
    expect(classify('503 Service Unavailable')).toEqual(expect.objectContaining({
      classification: 'transient',
      category: 'provider-server-error',
    }));
    expect(classify('stream aborted: ECONNRESET')).toEqual(expect.objectContaining({
      classification: 'transient',
      category: 'stream-abort',
    }));
    expect(classify('opencode timed out after 30000ms')).toEqual(expect.objectContaining({
      classification: 'transient',
      category: 'timeout',
    }));
    expect(classify('finish rejected: project validation did not pass; test failed because a spec timed out')).toEqual(expect.objectContaining({
      classification: 'terminal',
      category: 'validation-failure',
    }));
    expect(classify('External agent (opencode) produced no changes')).toEqual(expect.objectContaining({
      classification: 'terminal',
      category: 'agent-result',
    }));
    expect(classify('')).toEqual(expect.objectContaining({
      classification: 'terminal',
      category: 'unknown',
    }));
  });

  it('resumes the newest compatible session on a clean retry of the same CLI', async () => {
    const failedTask = {
      id: 'task-1',
      title: 'External retry',
      status: 'failed',
      error: 'stream aborted: ECONNRESET',
      retryCount: 0,
      retryHistory: null,
    };
    const doneTask = { ...failedTask, status: 'done', error: null, retryHistory: '[]' };
    const findUnique = vi.fn()
      .mockResolvedValueOnce(failedTask)
      .mockResolvedValueOnce(doneTask);
    const taskUpdate = vi.fn().mockResolvedValue(doneTask);
    const prisma = {
      task: {
        findUnique,
        update: taskUpdate,
      },
      agentRun: {
        findFirst: vi.fn().mockResolvedValue({ sessionId: 'opencode-session-77' }),
      },
    } as unknown as PrismaClient;
    mocks.runRoutedExternalAgentTask.mockResolvedValue({
      status: 'done',
      diff: 'diff --git a/a b/a',
      output: 'done',
      executionSucceeded: true,
    });

    await executeRetry(prisma, 'task-1', {
      strategy: 'clean-retry',
      cli: 'opencode',
      provider: 'external:opencode',
      model: 'openrouter/test-model',
      classification: 'transient',
      category: 'stream-abort',
      triggerError: 'stream aborted: ECONNRESET',
    }, {
      projectPath: '/tmp/project',
      projectName: 'project',
      autoPublish: false,
    });

    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        taskId: 'task-1',
        sessionKind: 'opencode-session',
      }),
    }));
    expect(mocks.runRoutedExternalAgentTask).toHaveBeenCalledWith(
      prisma,
      'task-1',
      expect.objectContaining({
        cli: 'opencode',
        resumeSession: {
          sessionId: 'opencode-session-77',
          sessionKind: 'opencode-session',
        },
      }),
    );
    const auditedHistory = taskUpdate.mock.calls
      .map(([call]) => (call as { data?: { retryHistory?: string } }).data?.retryHistory)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => JSON.parse(value) as Record<string, unknown>[])
      .find((records) => records.some((record) => record.decision === 'retry'));
    expect(auditedHistory?.at(-1)).toEqual(expect.objectContaining({
      classification: 'transient',
      category: 'stream-abort',
      decision: 'retry',
      triggerError: 'stream aborted: ECONNRESET',
    }));
  });
});
