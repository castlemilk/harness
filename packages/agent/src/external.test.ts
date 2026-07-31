import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@omega/db';

const mocks = vi.hoisted(() => ({
  runCodexTurn: vi.fn(),
  getCodexAvailability: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentCommit: vi.fn(),
  getDiff: vi.fn(),
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
  getDiff: mocks.getDiff,
  hasChanges: mocks.hasChanges,
  stageAllChanges: mocks.stageAllChanges,
  commit: mocks.commit,
}));

vi.mock('./project-utils.js', () => ({
  deriveVerificationCommand: mocks.deriveVerificationCommand,
}));

import { needsDependencyBootstrap, runExternalAgentTask } from './external.js';

const originalPath = process.env.PATH;
const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-external-agent-test-'));

beforeAll(() => {
  const fakeCodex = path.join(fakeBinDir, 'codex');
  fs.writeFileSync(fakeCodex, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ''}`;
  mocks.getCodexAvailability.mockResolvedValue({ available: true });
  mocks.getCurrentBranch.mockResolvedValue({ success: true, output: 'main' });
  mocks.getCurrentCommit.mockResolvedValue({ success: true, output: 'base-sha' });
  mocks.getDiff.mockResolvedValue({ success: true, output: 'diff --git a/src/file.ts b/src/file.ts\n' });
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
  vi.restoreAllMocks();
});

describe('runExternalAgentTask', () => {
  it('detects missing external-agent dependency markers', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dependency-test-'));

    try {
      expect(await needsDependencyBootstrap(projectPath)).toBe(true);

      fs.mkdirSync(path.join(projectPath, 'node_modules', '.pnpm'), { recursive: true });
      expect(await needsDependencyBootstrap(projectPath)).toBe(false);

      fs.rmSync(path.join(projectPath, 'node_modules', '.pnpm'), { recursive: true, force: true });
      fs.mkdirSync(path.join(projectPath, 'node_modules', '.bin'), { recursive: true });
      expect(await needsDependencyBootstrap(projectPath)).toBe(false);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
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
        provider: 'codex',
        model: 'gpt-5.6-luna',
      }),
    });
    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        resultStatus: 'done',
        turnCount: 1,
        toolCalls: JSON.stringify({ command: 1, fileChange: 1 }),
      }),
    });
  });
});
