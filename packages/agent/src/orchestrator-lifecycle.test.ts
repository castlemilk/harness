import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import type * as OrchestratorUtils from './orchestrator-utils.js';

const mocks = vi.hoisted(() => ({
  plannerSend: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentCommit: vi.fn(),
  getDiff: vi.fn(),
  getGradedDiff: vi.fn(),
  runAgentTask: vi.fn(),
  validateProject: vi.fn(),
}));

vi.mock('./executor.js', () => ({ runAgentTask: mocks.runAgentTask }));
vi.mock('./git.js', () => ({
  getCurrentBranch: mocks.getCurrentBranch,
  getCurrentCommit: mocks.getCurrentCommit,
  getDiff: mocks.getDiff,
  getGradedDiff: mocks.getGradedDiff,
}));
vi.mock('./validator.js', () => ({ validateProject: mocks.validateProject }));
vi.mock('./skill-generator.js', () => ({
  generateSkillFromTask: vi.fn(),
  recallRelevantSkills: vi.fn().mockResolvedValue([]),
}));
vi.mock('./orchestrator-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof OrchestratorUtils>();
  return {
    ...actual,
    loadProviderByName: vi.fn().mockResolvedValue({ send: mocks.plannerSend }),
    pickModel: vi.fn(async (_prisma: PrismaClient, tier: string) => tier === 'high'
      ? { provider: 'high-provider', model: 'high-model' }
      : { provider: 'low-provider', model: 'low-model' }),
  };
});

import { runOrchestratedTask } from './orchestrator.js';

describe('orchestrator lifecycle', () => {
  it('plans, routes, reviews, checkpoints, and captures the completed patch', async () => {
    const now = new Date('2026-08-28T00:00:00.000Z');
    let orchestratorState: string | null = null;
    const task = {
      id: 'parent-task',
      projectId: 'project-1',
      title: 'Add the feature',
      description: 'Implement the feature in src/feature.ts.',
      status: 'todo',
      complexity: 'simple',
      tags: JSON.stringify(['agent', 'orchestrate']),
      provider: null,
      model: null,
      result: null,
      error: null,
      orchestratorState: null,
      createdAt: now,
      updatedAt: now,
    };
    const taskUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (typeof data.orchestratorState === 'string') orchestratorState = data.orchestratorState;
      return { ...task, ...data };
    });
    const agentRun = {
      id: 'agent-run-1',
      taskId: task.id,
      branch: 'main',
      baseCommit: 'base-sha',
      resultStatus: 'running',
    };
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: taskUpdate,
        create: vi.fn().mockResolvedValue({ id: 'subtask-1' }),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue(agentRun),
        findUnique: vi.fn().mockResolvedValue(agentRun),
        update: vi.fn().mockResolvedValue(agentRun),
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    mocks.getCurrentBranch.mockResolvedValue({ success: true, output: 'main' });
    mocks.getCurrentCommit.mockResolvedValue({ success: true, output: 'base-sha' });
    mocks.getDiff.mockResolvedValue({ success: true, output: 'diff --git a/src/feature.ts b/src/feature.ts' });
    mocks.getGradedDiff.mockResolvedValue({
      success: true,
      output: 'diff --git a/src/feature.ts b/src/feature.ts\n+new feature',
      gradedPatchTestPaths: [],
      gradedPatchAddedTestPaths: [],
    });
    mocks.validateProject.mockResolvedValue({
      allPassed: true,
      lint: { passed: true, output: '' },
      test: { passed: true, output: '' },
      build: { passed: true, output: '' },
    });
    mocks.plannerSend
      .mockResolvedValueOnce(JSON.stringify([{
        title: 'Implement the feature',
        description: 'Edit src/feature.ts.',
        complexity: 'simple',
        tier: 'low',
        affectedFiles: ['src/feature.ts'],
      }]))
      .mockResolvedValueOnce(JSON.stringify({ status: 'done', notes: 'Implementation is complete.' }));
    mocks.runAgentTask.mockResolvedValue({
      task: {
        status: 'done',
        result: 'Implemented the feature.',
        provider: 'low-provider',
        model: 'low-model',
      },
    });

    const result = await runOrchestratedTask(prisma, task.id, {
      projectPath: '/tmp/project',
      projectName: 'project',
      maxSubtasks: 2,
      maxIterations: 1,
      maxEscalations: 0,
    });

    expect(result).toEqual(expect.objectContaining({
      taskId: task.id,
      agentRunId: agentRun.id,
      status: 'done',
      iterations: 1,
    }));
    expect(result.subtasks).toEqual([{
      taskId: 'subtask-1',
      title: 'Implement the feature',
      status: 'done',
    }]);
    expect(mocks.plannerSend).toHaveBeenCalledTimes(2);
    expect(mocks.runAgentTask).toHaveBeenCalledWith(
      prisma,
      'subtask-1',
      expect.objectContaining({
        isolated: false,
        tokenBudget: undefined,
      }),
      undefined,
    );
    expect((prisma.task.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      data: expect.objectContaining({
        provider: 'low-provider',
        model: 'low-model',
        tags: JSON.stringify(['subtask', `parent:${task.id}`]),
      }),
    });
    const checkpointPhases = taskUpdate.mock.calls
      .map(([call]) => call.data?.orchestratorState)
      .filter((state): state is string => typeof state === 'string')
      .map((state) => JSON.parse(state).phase);
    expect(checkpointPhases).toEqual(expect.arrayContaining(['starting', 'planned', 'executing', 'completed']));
    expect(JSON.parse(orchestratorState ?? '{}')).toEqual(expect.objectContaining({
      phase: 'completed',
      finished: true,
      planner: { provider: 'high-provider', model: 'high-model' },
    }));
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: task.id },
      data: expect.objectContaining({
        status: 'done',
        provider: 'high-provider',
        model: 'high-model',
      }),
    });
    expect((prisma.taskDiff.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: task.id, patch: expect.stringContaining('src/feature.ts') }),
    });
  });
});
