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
}));

vi.mock('./executor.js', () => ({ runAgentTask: mocks.runAgentTask }));
vi.mock('./git.js', () => ({
  getCurrentBranch: mocks.getCurrentBranch,
  getCurrentCommit: mocks.getCurrentCommit,
  getDiff: mocks.getDiff,
  getGradedDiff: mocks.getGradedDiff,
}));
vi.mock('./skill-generator.js', () => ({
  generateSkillFromTask: vi.fn(),
  recallRelevantSkills: vi.fn().mockResolvedValue([]),
}));
vi.mock('./orchestrator-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof OrchestratorUtils>();
  return {
    ...actual,
    loadProviderByName: vi.fn().mockResolvedValue({ send: mocks.plannerSend }),
  };
});

import { runOrchestratedTask } from './orchestrator.js';

describe('orchestrator caller cancellation', () => {
  it('combines caller cancellation with the subtask deadline and captures the parent patch', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const task = {
      id: 'parent-task',
      projectId: 'project-1',
      title: 'Orchestrated task',
      description: 'Implement it',
      status: 'todo',
      complexity: 'medium',
      tags: JSON.stringify(['agent', 'orchestrate']),
      provider: 'provider-1',
      model: 'model-1',
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const taskDiffCreate = vi.fn().mockResolvedValue({});
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: vi.fn().mockResolvedValue(task),
        create: vi.fn().mockResolvedValue({ id: 'subtask-1' }),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'agent-run-1' }),
        findUnique: vi.fn().mockResolvedValue({ validationSummary: null }),
        update: agentRunUpdate,
      },
      taskDiff: { create: taskDiffCreate },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    mocks.getCurrentBranch.mockResolvedValue({ success: true, output: 'main' });
    mocks.getCurrentCommit.mockResolvedValue({ success: true, output: 'base-sha' });
    mocks.getGradedDiff.mockResolvedValue({
      success: true,
      output: 'diff --git a/src/file.ts b/src/file.ts\n',
      gradedPatchTestPaths: ['tests/file.test.ts'],
      gradedPatchAddedTestPaths: ['tests/file.test.ts'],
    });
    mocks.plannerSend.mockResolvedValue(JSON.stringify([
      {
        title: 'Implement the change',
        description: 'Edit src/file.ts',
        complexity: 'medium',
        tier: 'medium',
      },
    ]));
    let subtaskSignal: AbortSignal | undefined;
    mocks.runAgentTask.mockImplementation(async (
      _prisma: PrismaClient,
      _taskId: string,
      options: { signal?: AbortSignal },
    ) => {
      subtaskSignal = options.signal;
      return await new Promise((resolve, reject) => {
        const onAbort = (): void => reject(options.signal?.reason);
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    const controller = new AbortController();

    const resultPromise = runOrchestratedTask(prisma, task.id, {
      projectPath: '/tmp/project',
      projectName: 'project',
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(mocks.runAgentTask).toHaveBeenCalledTimes(1);
    });
    expect(subtaskSignal).toBeDefined();
    expect(subtaskSignal).not.toBe(controller.signal);
    expect(subtaskSignal?.aborted).toBe(false);
    controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));

    await expect(resultPromise).rejects.toThrow('Benchmark cancelled');
    expect(subtaskSignal?.aborted).toBe(true);
    expect((subtaskSignal?.reason as Error).message).toBe('Benchmark cancelled');
    expect(taskDiffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: task.id,
        patch: expect.stringContaining('src/file.ts'),
      }),
    });
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'agent-run-1' },
      data: expect.objectContaining({
        validationSummary: expect.stringContaining('gradedPatchAddedTestPaths'),
      }),
    });
  });
});
