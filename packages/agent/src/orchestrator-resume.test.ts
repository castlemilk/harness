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
    pickModel: vi.fn().mockResolvedValue({ provider: 'high-provider', model: 'high-model' }),
  };
});

import { runOrchestratedTask } from './orchestrator.js';

describe('orchestrator resume checkpoints', () => {
  it('resumes the saved plan without replanning or recreating completed work', async () => {
    const now = new Date('2026-08-27T00:00:00.000Z');
    let savedState: string | null = null;
    const task = (): Record<string, unknown> => ({
      id: 'parent-task',
      projectId: 'project-1',
      title: 'Orchestrated task',
      description: 'Implement it',
      status: savedState ? 'failed' : 'todo',
      complexity: 'medium',
      tags: JSON.stringify(['agent', 'orchestrate']),
      provider: null,
      model: null,
      result: null,
      error: null,
      orchestratorState: savedState,
      createdAt: now,
      updatedAt: now,
    });
    const existingRun = {
      id: 'agent-run-1',
      taskId: 'parent-task',
      branch: 'main',
      baseCommit: 'base-sha',
      resultStatus: 'running',
    };
    const taskUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (typeof data.orchestratorState === 'string') savedState = data.orchestratorState;
      return { ...task(), ...data };
    });
    const prisma = {
      task: {
        findUnique: vi.fn().mockImplementation(async () => task()),
        update: taskUpdate,
        create: vi.fn().mockResolvedValue({ id: 'subtask-1' }),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue(existingRun),
        findUnique: vi.fn().mockResolvedValue(existingRun),
        update: vi.fn().mockResolvedValue(existingRun),
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    mocks.getCurrentBranch.mockResolvedValue({ success: true, output: 'main' });
    mocks.getCurrentCommit.mockResolvedValue({ success: true, output: 'base-sha' });
    mocks.getDiff.mockResolvedValue({ success: true, output: 'diff' });
    mocks.getGradedDiff.mockResolvedValue({
      success: true,
      output: 'diff --git a/src/file.ts b/src/file.ts\n',
      gradedPatchTestPaths: [],
      gradedPatchAddedTestPaths: [],
    });
    mocks.validateProject.mockResolvedValue({
      allPassed: true,
      lint: { passed: true, output: '' },
      test: { passed: true, output: '' },
      build: { passed: true, output: '' },
    });
    mocks.plannerSend.mockResolvedValueOnce(JSON.stringify([{
      title: 'Implement the change',
      description: 'Edit src/file.ts',
      complexity: 'medium',
      tier: 'medium',
    }]));

    const controller = new AbortController();
    mocks.runAgentTask.mockImplementationOnce(async (
      _prisma: PrismaClient,
      _taskId: string,
      options: { signal?: AbortSignal },
    ) => await new Promise((_resolve, reject) => {
      const onAbort = (): void => reject(options.signal?.reason);
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
    }));

    const firstRun = runOrchestratedTask(prisma, 'parent-task', {
      projectPath: '/tmp/project',
      projectName: 'project',
      maxEscalations: 0,
      maxIterations: 1,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.runAgentTask).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException('process interrupted', 'AbortError'));
    await expect(firstRun).rejects.toThrow('process interrupted');

    const checkpointAfterInterruption = JSON.parse(savedState ?? '{}') as {
      phase: string;
      subtasks: { status: string }[];
    };
    expect(checkpointAfterInterruption.phase).toBe('failed');
    expect(checkpointAfterInterruption.subtasks[0]?.status).toBe('failed');

    mocks.plannerSend.mockResolvedValueOnce(JSON.stringify({ status: 'done', notes: 'Resumed and completed.' }));
    mocks.runAgentTask.mockResolvedValueOnce({
      task: { status: 'done', result: 'Implemented after resume.', provider: 'medium-provider', model: 'medium-model' },
    });

    const resumed = await runOrchestratedTask(prisma, 'parent-task', {
      projectPath: '/tmp/project',
      projectName: 'project',
      maxEscalations: 0,
      maxIterations: 1,
    });

    expect(resumed.status).toBe('done');
    expect(mocks.plannerSend).toHaveBeenCalledTimes(2);
    expect(mocks.runAgentTask).toHaveBeenCalledTimes(2);
    expect((prisma.task.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect((prisma.agentRun.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const finalCheckpoint = JSON.parse(savedState ?? '{}') as {
      phase: string;
      subtasks: { status: string }[];
    };
    expect(finalCheckpoint.phase).toBe('completed');
    expect(finalCheckpoint.subtasks[0]?.status).toBe('done');
  });
});
