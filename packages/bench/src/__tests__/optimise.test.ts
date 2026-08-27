import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BenchmarkReport } from '../types.js';
import { buildOptimisePrompt, loadOptimisationContext, submitOptimiseTask } from '../optimise.js';

/**
 * The self-improvement loop's intake: benchmark report → optimise prompt →
 * self-improve task. These tests pin what the loop feeds the agent, because a
 * prompt that misreports the pass rate or drops the failures would send the
 * optimiser to fix the wrong thing — confidently.
 */

function report(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    suite: 'synthetic',
    startedAt: '2026-08-26T00:00:00Z',
    finishedAt: '2026-08-26T00:01:00Z',
    total: 4,
    passed: 3,
    failed: 1,
    results: [
      {
        task: { id: 't1', name: 'ok-task', title: 'ok', evaluate: () => ({ passed: true }) },
        harnessTaskId: 'task-41',
        status: 'done',
        durationMs: 1000,
        spanCount: 3,
        evaluation: { passed: true },
      },
      {
        task: { id: 't2', name: 'broken-task', title: 'broken', evaluate: () => ({ passed: false }) },
        harnessTaskId: 'task-42',
        status: 'failed',
        durationMs: 2000,
        spanCount: 5,
        evaluation: { passed: false, message: 'tests red after patch' },
      },
    ],
    ...overrides,
  } as BenchmarkReport;
}

describe('buildOptimisePrompt', () => {
  it('states the pass rate and lists the failed tasks with their messages', () => {
    const prompt = buildOptimisePrompt(report());
    expect(prompt).toContain('75% pass rate (3/4)');
    expect(prompt).toContain('- broken-task: tests red after patch');
  });

  it('carries the focus task when one is given', () => {
    const r = report();
    const focus = r.results[1];
    const prompt = buildOptimisePrompt(r, focus);
    expect(prompt).toContain('## Focus task: broken-task');
    expect(prompt).toContain('Evaluation: tests red after patch');
  });

  it('includes a truncated trace-flow snapshot', () => {
    const long = Array.from({ length: 200 }, (_, i) => `span-${String(i)}`).join('\n');
    const prompt = buildOptimisePrompt(report(), undefined, long);
    expect(prompt).toContain('## Trace flow snapshot');
    expect(prompt).toContain('(truncated)');
    expect(prompt).not.toContain('span-199\n');
  });

  it('directs edits at the prompt files and demands lint+test', () => {
    const prompt = buildOptimisePrompt(report());
    expect(prompt).toContain('packages/agent/src/prompts.ts');
    expect(prompt).toContain('pnpm lint');
  });
});

describe('submitOptimiseTask', () => {
  it('files a task tagged self-improve + benchmark', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'task-7' }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(submitOptimiseTask('http://api', 'proj-1', 'do better')).resolves.toEqual({
        id: 'task-7',
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://api/tasks');
      const body = JSON.parse(String(init.body)) as { tags: string[]; complexity: string };
      expect(body.tags).toEqual(['self-improve', 'benchmark']);
      expect(body.complexity).toBe('complex');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws with the status when the API rejects the task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 400 })));
    try {
      await expect(submitOptimiseTask('http://api', 'proj-1', 'x')).rejects.toThrow(/400/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('loadOptimisationContext', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'optimise-context-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns undefined when no benchmark report exists yet', async () => {
    await expect(loadOptimisationContext('http://api', dir)).resolves.toBeUndefined();
  });

  it('loads the newest report and its first failure’s trace flow', async () => {
    const older = JSON.stringify(report({ results: [] }));
    const newer = JSON.stringify(report());
    await fs.writeFile(path.join(dir, 'benchmark-001.json'), older);
    // Name sorts newer than benchmark-001.json.
    await fs.writeFile(path.join(dir, 'benchmark-010.json'), newer);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ traceId: 't1', spans: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const ctx = await loadOptimisationContext('http://api', dir);
      expect(ctx?.report.passed).toBe(3);
      expect(ctx?.failedResult?.task.name).toBe('broken-task');
      expect(ctx?.traceFlowText).toContain('traceId');
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toContain('/tasks/task-42/trace-flow');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips the trace fetch when the failure has no harness task', async () => {
    await fs.writeFile(
      path.join(dir, 'benchmark-020.json'),
      JSON.stringify(report({
        results: [{
          task: { id: 't3', name: 'x', title: 'x', evaluate: () => ({ passed: false }) },
          harnessTaskId: '',
          status: 'failed',
          durationMs: 1500,
          spanCount: 2,
          evaluation: { passed: false, message: 'm' },
        }],
      }))
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const ctx = await loadOptimisationContext('http://api', dir);
      // An empty harnessTaskId survives the JSON round trip as "" — still
      // falsy, which is what the "should we fetch a trace" check asks.
      expect(ctx?.failedResult?.harnessTaskId).toBe('');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(ctx?.traceFlowText).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
