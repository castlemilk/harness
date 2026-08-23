import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import type { Provider } from '@omega/core';
import type { AgentContext } from './agent-types.js';

const gitMocks = vi.hoisted(() => ({
  hasChanges: vi.fn().mockResolvedValue(false),
  stageAllChanges: vi.fn().mockResolvedValue({ success: true, output: '' }),
  commit: vi.fn().mockResolvedValue({ success: true, output: '' }),
  getDiff: vi.fn().mockResolvedValue({ success: true, output: '' }),
}));

vi.mock('./git.js', () => gitMocks);

import { executeAgentLoop } from './agent-loop.js';
import { Tracer } from './tracer.js';

describe('executeAgentLoop terminal disclosure', () => {
  it('cannot persist a failed task with an empty reason when the step limit is exhausted', async () => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    const taskRow = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Never silently fail',
      description: null,
      status: 'todo',
      complexity: 'simple',
      tags: null,
      provider: null,
      model: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const taskUpdate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...taskRow,
      ...data,
      updatedAt: now,
    }));
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: { update: taskUpdate },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      agentRun: { update: agentRunUpdate },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const provider = {
      config: { name: 'provider-one' },
      send: vi.fn().mockResolvedValue(JSON.stringify({ reasoning: 'No steps needed', plan: [] })),
    } as unknown as Provider;
    const tracer = new Tracer(prisma, taskRow.id, taskRow.id);
    const ctx: AgentContext = {
      prisma,
      task: {
        id: taskRow.id,
        projectId: taskRow.projectId,
        title: taskRow.title,
        status: 'todo',
        complexity: 'simple',
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
      projectPath: '/tmp/omega-agent-loop-test',
      projectName: 'test-project',
      provider,
      model: 'model-one',
      branch: 'agent/task-1',
      baseCommit: 'base-sha',
      agentRunId: 'run-1',
      autoPublish: false,
      maxSteps: 0,
      explorationBudget: { beforeFirstEdit: 2, betweenEdits: 2 },
      modifiedFiles: new Set(),
      consecutiveThinks: 0,
      explorationCount: 0,
      editCount: 0,
      explorationAtLastEdit: 0,
      explorationSinceLastEdit: 0,
      hasRunTestCommand: false,
      projectHasTests: false,
      tracer,
      rootSpan: tracer.startSpan('agent.task'),
      systemPrompt: 'system',
      textToolsSystemPrompt: 'tools',
      promptFormat: 'xml',
      usage: {},
      apiSurfaceVerified: false,
      turnCount: 0,
      stepCount: 0,
      deadlineMs: Date.now() + 60_000,
    };

    await executeAgentLoop(ctx, []);

    const terminalWrite = taskUpdate.mock.calls
      .map(([call]) => call as { data: { status?: string; error?: string | null; result?: string | null } })
      .find((call) => call.data.status === 'failed');
    expect(terminalWrite).toBeDefined();
    expect(terminalWrite?.data.error?.trim()).not.toBe('');
    expect(terminalWrite?.data.result).toBe(terminalWrite?.data.error);
    expect(terminalWrite?.data.error).toMatch(/step limit/i);
    expect(terminalWrite?.data.error).toMatch(/0 model turn/i);
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ resultStatus: 'failed', turnCount: 0 }),
    });
  });
});
