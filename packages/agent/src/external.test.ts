import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@omega/db';

const mocks = vi.hoisted(() => ({
  runCodexTurn: vi.fn(),
  getCodexAvailability: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentCommit: vi.fn(),
  getGradedDiff: vi.fn(),
  hasChanges: vi.fn(),
  stageAllChanges: vi.fn(),
  commit: vi.fn(),
  deriveVerificationCommand: vi.fn(),
}));

vi.mock('./codex-driver.js', () => ({
  runCodexTurn: mocks.runCodexTurn,
  getCodexAvailability: mocks.getCodexAvailability,
}));

vi.mock('./git.js', () => ({
  getCurrentBranch: mocks.getCurrentBranch,
  getCurrentCommit: mocks.getCurrentCommit,
  getGradedDiff: mocks.getGradedDiff,
  hasChanges: mocks.hasChanges,
  stageAllChanges: mocks.stageAllChanges,
  commit: mocks.commit,
}));

vi.mock('./project-utils.js', () => ({
  deriveVerificationCommand: mocks.deriveVerificationCommand,
}));

import { runExternalAgentTask } from './external.js';
import * as externalModule from './external.js';

const originalPath = process.env.PATH;
const fakeBinDir = fs.mkdtempSync(path.join(import.meta.dirname, 'test-fixtures', 'external-bin-'));

beforeAll(() => {
  const fakeCodex = path.join(fakeBinDir, 'codex');
  fs.writeFileSync(fakeCodex, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const fakeOpencode = path.join(fakeBinDir, 'opencode');
  fs.writeFileSync(
    fakeOpencode,
    [
      '#!/bin/sh',
      'if [ "${FAKE_OPENCODE_MODE:-}" = "hang" ]; then',
      '  trap "exit 42" TERM INT',
      '  while :; do sleep 1; done',
      'fi',
      'if [ "${FAKE_OPENCODE_MODE:-}" = "fail" ]; then',
      '  printf \'%s\\n\' \'{"type":"step_start","sessionID":"opencode-session-failed","part":{}}\'',
      '  printf \'%s\\n\' \'stream aborted: ECONNRESET\' >&2',
      '  exit 1',
      'fi',
      'printf \'%s\\n\' \'{"type":"text","sessionID":"opencode-session-42","part":{"text":"done"}}\'',
      'printf \'%s\\n\' \'{"type":"step_finish","sessionID":"opencode-session-42","part":{"reason":"stop","tokens":{"input":5,"output":3,"total":8}}}\'',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
});

afterAll(() => {
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ''}`;
  delete process.env.FAKE_OPENCODE_MODE;
  mocks.getCodexAvailability.mockResolvedValue({ available: true });
  mocks.getCurrentBranch.mockResolvedValue({ success: true, output: 'main' });
  mocks.getCurrentCommit.mockResolvedValue({ success: true, output: 'base-sha' });
  mocks.getGradedDiff.mockResolvedValue({
    success: true,
    output: 'diff --git a/src/file.ts b/src/file.ts\n',
    specGatePathsRemoved: [],
    gradedPatchTestPaths: [],
  });
  mocks.hasChanges.mockResolvedValue(false);
  mocks.deriveVerificationCommand.mockResolvedValue('pnpm test');
  mocks.runCodexTurn.mockResolvedValue({
    status: 'completed',
    finalMessage: 'Done.',
    threadId: 'thread-1',
    turnId: 'turn-1',
    commandExecutions: [{ command: 'pnpm test' }],
    fileChanges: [{ path: 'src/file.ts' }],
    touchedFiles: ['src/file.ts'],
  });
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.FAKE_OPENCODE_MODE;
  vi.restoreAllMocks();
});

describe('runExternalAgentTask', () => {
  it('derives each external spawn timeout from one absolute run deadline', () => {
    expect(externalModule.remainingExternalRunMs(10_000, 2_500)).toBe(7_500);
    expect(externalModule.remainingExternalRunMs(10_000, 10_000)).toBe(0);
  });

  it('gives an external agent an observable absolute wall-clock deadline', async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Timed task',
          description: 'TIME BUDGET: Finish before the deadline',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 60_000,
    });

    expect(mocks.runCodexTurn).toHaveBeenCalledWith(
      '/tmp/project',
      expect.stringMatching(/Absolute wall-clock deadline \(UTC\): .*Z/),
      expect.any(Object),
    );
  });

  it('passes caller cancellation into the Codex app-server turn', async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Cancelable task',
          description: 'Implement it',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const controller = new AbortController();

    await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 60_000,
      signal: controller.signal,
    });

    expect(mocks.runCodexTurn).toHaveBeenCalledWith(
      '/tmp/project',
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('does not perturb an external prompt when time guidance is disabled', async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Baseline task',
          description: 'Baseline description without the time experiment',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 60_000,
    });

    const prompt = mocks.runCodexTurn.mock.calls[0]?.[1] as string;
    expect(prompt).not.toContain('Absolute wall-clock deadline');
    expect(prompt).not.toContain('Wall-clock budget started');
  });

  it('records Codex phase timings in the metrics envelope, agent run, and trace', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.runCodexTurn.mockImplementation(async (_cwd, _prompt, options) => {
      now = 1_100;
      options.onProgress?.('Inspecting the repository.', 'investigating');
      now = 1_200;
      options.onProgress?.('Editing files.', 'editing');
      now = 1_300;
      options.onProgress?.('Running the build.', 'running');
      now = 1_400;
      options.onProgress?.('Verifying the changes.', 'verifying');
      now = 1_500;
      options.onProgress?.('Finalizing the turn.', 'finalizing');
      now = 1_750;
      return {
        status: 'completed',
        finalMessage: 'Done.',
        threadId: 'thread-1',
        turnId: 'turn-1',
        commandExecutions: [{ command: 'pnpm test' }],
        fileChanges: [{ path: 'src/file.ts' }],
        touchedFiles: ['src/file.ts'],
      };
    });

    const taskUpdate = vi.fn().mockResolvedValue({});
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const traceSpanCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Test task',
          description: 'Test description',
          tags: null,
        }),
        update: taskUpdate,
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: agentRunUpdate,
      },
      taskDiff: {
        create: vi.fn().mockResolvedValue({}),
      },
      traceSpan: {
        create: traceSpanCreate,
      },
    } as unknown as PrismaClient;

    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const result = await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 1_000,
    });

    expect(result.status).toBe('done');

    const metricsEnvelope = stringifySpy.mock.calls
      .map(([value]) => value)
      .find((value) => (
        typeof value === 'object' &&
        value !== null &&
        'turns' in value &&
        (value as { turns?: number }).turns === 1
      )) as Record<string, unknown> | undefined;
    expect(metricsEnvelope).toEqual(expect.objectContaining({
      turnDurationMs: 750,
      phaseTimings: {
        investigating: 100,
        editing: 100,
        running: 100,
        verifying: 100,
        finalizing: 250,
      },
    }));

    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        resultStatus: 'done',
        turnDurationMs: 750,
        phaseTimings: JSON.stringify({
          investigating: 100,
          editing: 100,
          running: 100,
          verifying: 100,
          finalizing: 250,
        }),
      }),
    });

    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        currentPhase: 'verifying',
        currentPhaseStartedAt: expect.any(Date),
      }),
    });

    const codexSpan = traceSpanCreate.mock.calls
      .map(([call]) => call as { data?: { name?: string; attributes?: string; events?: string } })
      .find((call) => call.data?.name === 'external.codex');
    expect(codexSpan?.data?.attributes).toBeDefined();
    expect(JSON.parse(codexSpan?.data?.attributes ?? '{}')).toEqual(expect.objectContaining({
      turnDurationMs: 750,
      phaseTimings: {
        investigating: 100,
        editing: 100,
        running: 100,
        verifying: 100,
        finalizing: 250,
      },
    }));
    expect(JSON.parse(codexSpan?.data?.events ?? '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'codex.progress', attributes: expect.objectContaining({ phase: 'investigating' }) }),
      expect.objectContaining({ name: 'codex.progress', attributes: expect.objectContaining({ phase: 'finalizing' }) }),
    ]));
  });

  it('records the configured Codex model and effort while preserving provider identity', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({});
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Test task',
          description: 'Test description',
          tags: null,
        }),
        update: taskUpdate,
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: agentRunUpdate,
      },
      taskDiff: {
        create: vi.fn().mockResolvedValue({}),
      },
      traceSpan: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const result = await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      model: 'gpt-5.6-luna',
      effort: 'max',
      timeoutMs: 1_000,
    });

    expect(result.status).toBe('done');
    expect(mocks.runCodexTurn).toHaveBeenCalledWith(
      '/tmp/project',
      expect.any(String),
      expect.objectContaining({ model: 'gpt-5.6-luna', effort: 'max' }),
    );

    const metricsEnvelope = stringifySpy.mock.calls
      .map(([value]) => value)
      .find((value) => (
        typeof value === 'object' &&
        value !== null &&
        'turns' in value &&
        (value as { turns?: number }).turns === 1
      )) as Record<string, unknown> | undefined;
    expect(metricsEnvelope).toEqual(expect.objectContaining({
      model: 'gpt-5.6-luna',
      effort: 'max',
    }));

    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({
        status: 'done',
        provider: 'external:codex',
        model: 'gpt-5.6-luna',
      }),
    });
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        resultStatus: 'done',
        sessionId: 'thread-1',
        sessionKind: 'codex-thread',
        turnCount: 1,
        toolCalls: JSON.stringify({ command: 1, fileChange: 1 }),
      }),
    });
  });

  it('stores only the graded patch and persists the marker-strip audit', async () => {
    mocks.getGradedDiff.mockResolvedValueOnce({
      success: true,
      output: 'diff --git a/src/file.ts b/src/file.ts\n',
      specGatePathsRemoved: ['tests/file.omega_specgate.test.ts'],
      gradedPatchTestPaths: [],
    });
    const taskDiffCreate = vi.fn().mockResolvedValue({});
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Test task',
          description: 'Test description',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        findUnique: vi.fn().mockResolvedValue({ validationSummary: null }),
        update: agentRunUpdate,
      },
      taskDiff: { create: taskDiffCreate },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 1_000,
    });

    expect(taskDiffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ patch: expect.not.stringContaining('omega_specgate') }),
    });
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        validationSummary: JSON.stringify({
          patchAudit: {
            specgateThrowawayPathsRemoved: 1,
            specgateThrowawayPaths: ['tests/file.omega_specgate.test.ts'],
            gradedPatchTestPaths: 0,
          },
        }),
      }),
    });
  });

  it('initializes currentTurn=1 at agentRun creation', async () => {
    const agentRunCreate = vi.fn().mockResolvedValue({ id: 'run-1' });
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Test task',
          description: 'Test description',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: agentRunCreate,
        update: agentRunUpdate,
      },
      taskDiff: {
        create: vi.fn().mockResolvedValue({}),
      },
      traceSpan: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    await runExternalAgentTask(prisma, 'task-1', {
      cli: 'codex',
      projectPath: '/tmp/project',
      projectName: 'project',
      timeoutMs: 1_000,
    });

    expect(agentRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ currentTurn: 1 }),
    });
  });

  it('constructs an explicit OpenCode resume invocation for the captured session', () => {
    const buildArgs = (externalModule as unknown as {
      buildExternalCliArgs?: (
        cli: string,
        prompt: string,
        cwd: string,
        model: string | undefined,
        session: { sessionId: string; sessionKind: string },
      ) => string[];
    }).buildExternalCliArgs;
    expect(buildArgs).toBeTypeOf('function');
    if (!buildArgs) return;

    const args = buildArgs(
      'opencode',
      'Continue useful investigation',
      '/tmp/project',
      'openrouter/test-model',
      { sessionId: 'opencode-session-existing', sessionKind: 'opencode-session' },
    );
    const sessionFlag = args.indexOf('--session');
    expect(sessionFlag).toBeGreaterThanOrEqual(0);
    expect(args[sessionFlag + 1]).toBe('opencode-session-existing');
  });

  it('constructs the installed Codex CLI resume form with parent options first', () => {
    const args = externalModule.buildExternalCliArgs(
      'codex',
      'Continue useful investigation',
      '/tmp/project',
      undefined,
      { sessionId: 'codex-thread-existing', sessionKind: 'codex-thread' },
    );

    expect(args).toEqual([
      'exec',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--json',
      'resume',
      'codex-thread-existing',
      'Continue useful investigation',
    ]);
  });

  it('captures an OpenCode stream session on the AgentRun row', async () => {
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'OpenCode task',
          description: 'Capture the session',
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: agentRunUpdate,
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await runExternalAgentTask(prisma, 'task-1', {
      cli: 'opencode',
      projectPath: fakeBinDir,
      projectName: 'project',
      model: 'openrouter/test-model',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('done');
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        sessionId: 'opencode-session-42',
        sessionKind: 'opencode-session',
      }),
    });
  });

  it('captures the OpenCode session before disclosing a transient nonzero exit', async () => {
    process.env.FAKE_OPENCODE_MODE = 'fail';
    const agentRunUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Interrupted OpenCode task',
          description: null,
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: agentRunUpdate,
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await runExternalAgentTask(prisma, 'task-1', {
      cli: 'opencode',
      projectPath: fakeBinDir,
      projectName: 'project',
      timeoutMs: 5_000,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      output: expect.stringMatching(/ECONNRESET/),
      executionSucceeded: false,
    }));
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        sessionId: 'opencode-session-failed',
        sessionKind: 'opencode-session',
      }),
    });
  });

  it('terminates a standard external CLI promptly when the caller aborts', async () => {
    process.env.FAKE_OPENCODE_MODE = 'hang';
    mocks.getGradedDiff.mockResolvedValueOnce({
      success: true,
      output: '',
      specGatePathsRemoved: [],
      gradedPatchTestPaths: [],
    });
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Cancelable OpenCode task',
          description: null,
          tags: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      agentRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      taskDiff: { create: vi.fn().mockResolvedValue({}) },
      taskTrace: { create: vi.fn().mockResolvedValue({}) },
      traceSpan: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const controller = new AbortController();
    const startedAt = Date.now();
    const resultPromise = runExternalAgentTask(prisma, 'task-1', {
      cli: 'opencode',
      projectPath: fakeBinDir,
      projectName: 'project',
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));
    }, 100);

    const result = await resultPromise;
    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      executionSucceeded: false,
      output: expect.stringMatching(/Benchmark cancelled/),
    }));
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
