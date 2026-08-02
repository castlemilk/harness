import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBenchmark } from '../runner.js';
import type { BenchmarkTask } from '../types.js';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  waitForTask: vi.fn(),
  getAgentRun: vi.fn(),
  getDiffs: vi.fn(),
  pollForDiffs: vi.fn(),
  getTraceFlow: vi.fn(),
  getTraceSummary: vi.fn(),
  getPromptVersion: vi.fn(),
  withRetry: vi.fn(),
  countSpans: vi.fn(() => 0),
}));

vi.mock('../api-client.js', () => ({
  ensureProject: mocks.ensureProject,
  createTask: mocks.createTask,
  runTask: mocks.runTask,
  waitForTask: mocks.waitForTask,
  getAgentRun: mocks.getAgentRun,
  getDiffs: mocks.getDiffs,
  pollForDiffs: mocks.pollForDiffs,
  getTraceFlow: mocks.getTraceFlow,
  getTraceSummary: mocks.getTraceSummary,
  getPromptVersion: mocks.getPromptVersion,
  withRetry: mocks.withRetry,
  countSpans: mocks.countSpans,
}));

const makeTask = (): BenchmarkTask => ({
  id: 't1',
  name: 'test-task',
  title: 'Test task',
  description: 'desc',
  complexity: 'simple',
  tags: [],
  // Must write a file so ensureGitRepo's 'git add . && git commit' has
  // something to stage — an empty dir makes git commit exit 1.
  setup: async (p: string) => {
    await fs.writeFile(path.join(p, 'README.md'), 'x');
  },
  evaluate: vi.fn().mockResolvedValue({ passed: false, message: '' }),
});

describe('runBenchmark taskError capture', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Route runtime dirs to a temp dir so tests don't pollute ~/.omega
    process.env.OMEGA_STORAGE_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-test-'));
    mocks.ensureProject.mockResolvedValue({ id: 'p1' });
    mocks.createTask.mockResolvedValue({ id: 'ht1', status: 'todo' });
    mocks.runTask.mockResolvedValue(undefined);
    mocks.getAgentRun.mockResolvedValue(undefined);
    mocks.getDiffs.mockResolvedValue([]);
    mocks.pollForDiffs.mockResolvedValue([]);
    mocks.getTraceFlow.mockResolvedValue(undefined);
    mocks.getTraceSummary.mockResolvedValue(undefined);
    mocks.getPromptVersion.mockResolvedValue(undefined);
    mocks.withRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  });

  it('captures taskError from waitForTask when the task failed with an error', async () => {
    mocks.waitForTask.mockResolvedValue({ status: 'failed', error: 'provider crashed' });
    const report = await runBenchmark([makeTask()], { apiUrl: 'http://x', suiteName: 'fast' });
    expect(report.results[0]?.status).toBe('failed');
    expect(report.results[0]?.taskError).toBe('provider crashed');
    expect(report.results[0]?.evaluation.message).toBe('provider crashed');
  });

  it('uses taskError as the message fallback when evaluation produced none', async () => {
    mocks.waitForTask.mockResolvedValue({ status: 'failed', error: 'rate limited' });
    const report = await runBenchmark([makeTask()], { apiUrl: 'http://x', suiteName: 'fast' });
    expect(report.results[0]?.evaluation.message).toBe('rate limited');
  });

  it('prefers taskError over a thrown evaluate error when it carries a server-side reason', async () => {
    mocks.waitForTask.mockResolvedValue({ status: 'failed', error: 'provider crashed' });
    const task = makeTask();
    task.evaluate = vi.fn().mockRejectedValue(new Error('evaluate exploded'));
    const report = await runBenchmark([task], { apiUrl: 'http://x', suiteName: 'fast' });
    expect(report.results[0]?.evaluation.message).toBe('provider crashed');
  });
});
