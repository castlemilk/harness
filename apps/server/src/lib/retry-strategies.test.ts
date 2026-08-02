import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@omega/db';
import { getNextStrategy, type RetryContext } from './retry-strategies.js';

function makePrismaMock(opts: {
  providers?: Array<{ kind: string; enabled: boolean; defaultModel: string; capabilities: unknown }>;
}): PrismaClient {
  return {
    providerConfig: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { kind: string } }) => {
        return opts.providers?.find((p) => p.kind === where.kind) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where?: { enabled?: boolean; kind?: { not?: string } } }) => {
        let result = opts.providers ?? [];
        if (where?.enabled === true) result = result.filter((p) => p.enabled);
        if (where?.kind?.not) result = result.filter((p) => p.kind !== where.kind.not);
        return result;
      }),
    },
  } as unknown as PrismaClient;
}

function makeCtx(
  overrides: Partial<RetryContext['task']> = {},
  prisma?: PrismaClient,
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
  beforeEach(() => vi.clearAllMocks());

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
});
