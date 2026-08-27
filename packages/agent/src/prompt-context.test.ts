import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import { buildPromptContext } from './prompt-context.js';

describe('buildPromptContext provider telemetry', () => {
  it('feeds persisted routing and budget health into future agent context', async () => {
    const prisma = {
      agentRun: {
        findMany: vi.fn().mockResolvedValue([{
          providerCalls: 4,
          providerRetries: 26,
          providerRateLimitRetries: 26,
          providerRotations: 3,
          effectiveModel: 'minimax/minimax-m3:free',
          modelsTried: JSON.stringify(['z-ai/glm-5.2:free', 'minimax/minimax-m3:free']),
          tokenBudgetExceeded: false,
          validationSummary: JSON.stringify({ allPassed: true }),
          task: {
            id: 'task-1',
            title: 'Free model task',
            description: 'Implement a parser',
            provider: 'openrouter',
            model: 'z-ai/glm-5.2:free',
          },
        }]),
      },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
      traceSpan: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      taskStep: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const context = await buildPromptContext(prisma, 'project-1');

    expect(context.text).toContain('Provider and budget health from recent runs:');
    expect(context.text).toContain('26 rate-limit retries');
    expect(context.text).toContain('3 rotations');
    expect(context.text).toContain('effective model minimax/minimax-m3:free');
    expect(context.text).toContain('Prefer healthy free-model alternatives');
  });

  it('includes benchmark telemetry from other projects for self-improvement tasks', async () => {
    const prisma = {
      agentRun: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{
            id: 'benchmark-run-1',
            providerCalls: 4,
            providerRateLimitRetries: 26,
            providerRotations: 3,
            effectiveModel: 'minimax/minimax-m3:free',
            task: {
              title: 'benchmark task',
              provider: 'openrouter',
              model: 'z-ai/glm-5.2:free',
              project: { name: 'benchmark-project' },
            },
          }]),
      },
      taskDiff: { findMany: vi.fn().mockResolvedValue([]) },
      traceSpan: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      taskStep: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const context = await buildPromptContext(prisma, 'self-improve-project');

    expect(context.text).toContain('Recent global harness telemetry:');
    expect(context.text).toContain('benchmark-project/benchmark task');
    expect(context.text).toContain('26 rate-limit retries');
  });
});
