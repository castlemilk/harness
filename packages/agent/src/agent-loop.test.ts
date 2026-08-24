import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import type { Provider } from '@omega/core';
import type { AgentContext } from './agent-types.js';

const gitMocks = vi.hoisted(() => ({
  hasChanges: vi.fn().mockResolvedValue(false),
  stageAllChanges: vi.fn().mockResolvedValue({ success: true, output: '' }),
  commit: vi.fn().mockResolvedValue({ success: true, output: '' }),
  getGradedDiff: vi.fn().mockResolvedValue({
    success: true,
    output: '',
    specGatePathsRemoved: [],
    gradedPatchTestPaths: [],
  }),
  getDiff: vi.fn().mockResolvedValue({ success: true, output: '' }),
}));

vi.mock('./git.js', () => gitMocks);

import { executeAgentLoop, formatBudgetNotice } from './agent-loop.js';
import { Tracer } from './tracer.js';

describe('executeAgentLoop terminal disclosure', () => {
  it('reports both remaining steps and remaining wall-clock in budget notices', () => {
    expect(formatBudgetNotice(12, 8 * 60_000 + 12_000)).toContain('12 steps remain');
    expect(formatBudgetNotice(12, 8 * 60_000 + 12_000)).toContain('8m 12s wall-clock remain');
  });

  it('reproduces the pre-experiment budget notice when both switches are off', () => {
    expect(formatBudgetNotice(12, 8 * 60_000, {
      timeBudget: false,
      specGate: false,
    })).toBe(
      '[budget notice] 12 steps remain. Focus: complete the core implementation, verify it compiles/tests, clean scratch files, then finish. No new exploration.',
    );
  });

  it('cannot persist a failed task with an empty reason when the step limit is exhausted', async () => {
    gitMocks.getGradedDiff.mockResolvedValueOnce({
      success: true,
      output: 'diff --git a/src/value.ts b/src/value.ts\n',
      specGatePathsRemoved: ['tests/value.omega_specgate.test.ts'],
      gradedPatchTestPaths: [],
    });
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
    const taskDiffCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: { update: taskUpdate },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      taskDiff: { create: taskDiffCreate },
      agentRun: {
        findUnique: vi.fn().mockResolvedValue({ validationSummary: JSON.stringify({ allPassed: false }) }),
        update: agentRunUpdate,
      },
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
      deadlineMs: Date.now() + 10 * 60_000,
    };

    await executeAgentLoop(ctx, []);

    expect(provider.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeoutMs: 120_000 }),
    );

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
      data: expect.objectContaining({
        resultStatus: 'failed',
        turnCount: 0,
        validationSummary: JSON.stringify({
          allPassed: false,
          patchAudit: {
            specgateThrowawayPathsRemoved: 1,
            specgateThrowawayPaths: ['tests/value.omega_specgate.test.ts'],
            gradedPatchTestPaths: 0,
          },
        }),
      }),
    });
    expect(taskDiffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ patch: expect.not.stringContaining('omega_specgate') }),
    });
  });

  it('captures the filtered patch and audit when the deadline interrupts an in-flight provider', async () => {
    gitMocks.getGradedDiff.mockResolvedValueOnce({
      success: true,
      output: 'diff --git a/src/value.ts b/src/value.ts\n',
      specGatePathsRemoved: ['tests/value.omega_specgate.test.ts'],
      gradedPatchTestPaths: ['tests/value.test.ts'],
    });
    const now = new Date('2026-08-23T00:00:00.000Z');
    const controller = new AbortController();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const provider = {
      config: { name: 'provider-one' },
      send: vi.fn().mockImplementation(() => {
        providerStarted();
        return new Promise<string>(() => undefined);
      }),
    } as unknown as Provider;
    const taskUpdate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'task-2',
      projectId: 'project-1',
      title: 'Keep work at deadline',
      status: data.status ?? 'todo',
      complexity: 'medium',
      tags: null,
      description: null,
      provider: data.provider ?? null,
      model: data.model ?? null,
      result: data.result ?? null,
      error: data.error ?? null,
      createdAt: now,
      updatedAt: now,
      ...data,
    }));
    const taskDiffCreate = vi.fn().mockResolvedValue({});
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: { update: taskUpdate },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      taskDiff: { create: taskDiffCreate },
      agentRun: {
        findUnique: vi.fn().mockResolvedValue({ validationSummary: null }),
        update: agentRunUpdate,
      },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const tracer = new Tracer(prisma, 'task-2', 'task-2');
    const ctx: AgentContext = {
      prisma,
      task: {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Keep work at deadline',
        status: 'todo',
        complexity: 'medium',
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
      projectPath: '/tmp/omega-agent-deadline-test',
      projectName: 'test-project',
      provider,
      model: 'model-one',
      branch: 'agent/task-2',
      baseCommit: 'base-sha',
      agentRunId: 'run-2',
      autoPublish: false,
      maxSteps: 5,
      explorationBudget: { beforeFirstEdit: 2, betweenEdits: 2 },
      modifiedFiles: new Set(['src/value.ts']),
      consecutiveThinks: 0,
      explorationCount: 0,
      editCount: 1,
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
      signal: controller.signal,
    };

    const running = executeAgentLoop(ctx, []);
    await started;
    controller.abort(new DOMException('deadline reached', 'TimeoutError'));
    await running;

    expect(taskDiffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patch: 'diff --git a/src/value.ts b/src/value.ts\n',
      }),
    });
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: expect.objectContaining({
        resultStatus: 'failed',
        validationSummary: JSON.stringify({
          patchAudit: {
            specgateThrowawayPathsRemoved: 1,
            specgateThrowawayPaths: ['tests/value.omega_specgate.test.ts'],
            gradedPatchTestPaths: 1,
          },
        }),
      }),
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-2' },
      data: expect.objectContaining({ status: 'failed', result: expect.stringMatching(/wall-clock deadline/i) }),
    });
  });
});
