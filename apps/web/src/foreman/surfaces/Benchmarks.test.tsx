import type { ReactElement, SyntheticEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { foremanApi, type BenchmarkRunSummary, type BenchmarkTaskResult } from '../data/api.js';
import {
  BenchmarkRunDisclosure,
  BenchmarkRunDisclosureView,
  createBenchmarkDetailController,
  DeepSweTaskResults,
  deepSweTaskState,
  isDeepSweSuite,
  shouldLoadBenchmarkDetail,
} from './Benchmarks.js';

function result(input: {
  passed: boolean;
  partial: number;
  taskName?: string;
  metrics?: Record<string, number | string>;
}) {
  return {
    taskName: input.taskName ?? 'sqlfmt-create-table-ddl-formatting',
    harnessTaskId: `task-${String(input.partial)}`,
    passed: input.passed,
    durationMs: 90_000,
    evaluation: {
      passed: input.passed,
      score: input.partial,
      message: input.passed ? 'passed' : 'failed',
      metrics: {
        partial: input.partial,
        f2p_passed: 32,
        f2p_total: 32,
        p2p_passed: 1248,
        p2p_total: 1273,
        verifier_mode: 'docker',
        ...input.metrics,
      },
    },
  };
}

describe('DeepSWE benchmark task detail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies near misses from failed-task f2p completion, independently of partial reward', () => {
    expect(deepSweTaskState(result({
      passed: false,
      partial: 0.1,
      metrics: { f2p_passed: 16, f2p_total: 32 },
    }))).toBe('near-miss');
    expect(deepSweTaskState(result({
      passed: false,
      partial: 0.999,
      metrics: { f2p_passed: 15, f2p_total: 32 },
    }))).toBe('failed');
    expect(deepSweTaskState(result({
      passed: false,
      partial: 1,
      metrics: { f2p_passed: 0, f2p_total: 0 },
    }))).toBe('failed');
    expect(deepSweTaskState(result({ passed: true, partial: 0.1 }))).toBe('passed');
  });

  it('renders partial reward, f2p/p2p detail, verifier mode, and flake disclosures', () => {
    const html = renderToStaticMarkup(
      <DeepSweTaskResults
        results={[
          result({
            passed: false,
            partial: 0.981,
            metrics: {
              f2p_passed: 16,
              f2p_total: 32,
              flake_rerun: 1,
              p2p_rerun_failure_disjoint: 1,
            },
          }),
          result({
            passed: true,
            partial: 1,
            taskName: 'forgiven-example',
            metrics: { flake_forgiven_pass: 1 },
          }),
        ]}
      />,
    );

    expect(html).toContain('failed');
    expect(html).toContain('near miss');
    expect(html).toContain('partial 0.981');
    expect(html).toContain('f2p 32/32');
    expect(html).toContain('p2p 1248/1273');
    expect(html).toContain('docker');
    expect(html).toContain('flake rerun');
    expect(html).toContain('forgiven pass');
    expect(html).toContain('rerun failures disjoint');
  });

  it('renders an explicit zero partial as a number without changing the f2p verdict', () => {
    const html = renderToStaticMarkup(
      <DeepSweTaskResults results={[result({ passed: false, partial: 0 })]} />,
    );

    expect(html).toContain('partial 0.000');
    expect(html).toContain('near miss');
  });

  it('recognises both suite spellings used by the server and CLI', () => {
    expect(isDeepSweSuite('deepswe')).toBe(true);
    expect(isDeepSweSuite('deep-swe')).toBe(true);
    expect(isDeepSweSuite('fast')).toBe(false);
  });

  it('loads run detail only when an uncached disclosure is expanded', async () => {
    expect(shouldLoadBenchmarkDetail(false, 'idle')).toBe(false);
    expect(shouldLoadBenchmarkDetail(true, 'loaded')).toBe(false);
    expect(shouldLoadBenchmarkDetail(true, 'loading')).toBe(false);
    expect(shouldLoadBenchmarkDetail(true, 'idle')).toBe(true);
    expect(shouldLoadBenchmarkDetail(true, 'error')).toBe(true);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'run/with space', results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(foremanApi.getBenchmarkDetails('run/with space')).resolves.toEqual({
      id: 'run/with space',
      results: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/foreman/benchmarks/run%2Fwith%20space',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('runs detail requests through a closed/open/cache lifecycle', async () => {
    let resolveRequest: ((value: { id: string; results: BenchmarkTaskResult[] }) => void) | undefined;
    const loader = vi.fn(() => new Promise<{ id: string; results: BenchmarkTaskResult[] }>((resolve) => {
      resolveRequest = resolve;
    }));
    const controller = createBenchmarkDetailController('run-lazy', undefined, loader);
    const onChange = vi.fn();
    const unsubscribe = controller.subscribe(onChange);

    await controller.toggle(false);
    expect(loader).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({ status: 'idle' });
    expect(onChange).not.toHaveBeenCalled();

    const firstOpen = controller.toggle(true);
    expect(loader).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual({ status: 'loading' });
    expect(onChange).toHaveBeenCalledOnce();
    resolveRequest?.({ id: 'run-lazy', results: [result({ passed: true, partial: 1 })] });
    await firstOpen;
    expect(controller.getSnapshot()).toMatchObject({ status: 'loaded', results: [{ passed: true }] });
    expect(onChange).toHaveBeenCalledTimes(2);

    await controller.toggle(false);
    await controller.toggle(true);
    expect(loader).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('surfaces a detail error and retries it on the next open', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('detail unavailable'))
      .mockResolvedValueOnce({ id: 'run-retry', results: [] });
    const controller = createBenchmarkDetailController('run-retry', undefined, loader);

    await controller.toggle(true);
    expect(controller.getSnapshot()).toEqual({ status: 'error', message: 'detail unavailable' });

    await controller.toggle(false);
    await controller.toggle(true);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toEqual({ status: 'loaded', results: [] });
  });

  it('wires the disclosure view toggle to its supplied handler', () => {
    const onToggle = vi.fn((_event: SyntheticEvent<HTMLDetailsElement>) => undefined);
    const element = BenchmarkRunDisclosureView({
      detail: { status: 'idle' },
      onToggle,
    }) as ReactElement<{ onToggle?: typeof onToggle }>;

    expect(element.type).toBe('details');
    expect(element.props.onToggle).toBe(onToggle);
  });

  it('renders a stale aggregate row that omits results without crashing', () => {
    const run: BenchmarkRunSummary = {
      id: 'legacy-run',
      suite: 'deepswe',
      provider: null,
      model: null,
      totalTasks: 1,
      passed: 0,
      failed: 1,
      timeouts: 0,
      passRate: 0,
      totalCostUsd: null,
      totalTokens: null,
      createdAt: '2026-08-24T00:00:00.000Z',
    };

    expect(() => renderToStaticMarkup(<BenchmarkRunDisclosure run={run} />)).not.toThrow();
    expect(renderToStaticMarkup(<BenchmarkRunDisclosure run={run} />)).toContain('view task results');
  });

  it('renders legacy task rows without an evaluation instead of crashing the tab', () => {
    const legacy = {
      taskName: 'legacy-task',
      harnessTaskId: 'legacy-1',
      passed: false,
      durationMs: 10,
      error: 'legacy failure',
    } as unknown as BenchmarkTaskResult;

    expect(() => renderToStaticMarkup(<DeepSweTaskResults results={[legacy]} />)).not.toThrow();
    const html = renderToStaticMarkup(<DeepSweTaskResults results={[legacy]} />);
    expect(html).toContain('failed');
    expect(html).toContain('partial —');
    expect(html).toContain('f2p —');
    expect(html).toContain('p2p —');
  });

  it('treats malformed persisted numeric metrics as unavailable', () => {
    const malformed = {
      taskName: 'malformed-task',
      harnessTaskId: 'malformed-1',
      passed: false,
      durationMs: 10,
      evaluation: {
        passed: false,
        score: 'not-a-number',
        metrics: { partial: 'also-not-a-number' },
      },
    } as unknown as BenchmarkTaskResult;

    expect(() => renderToStaticMarkup(<DeepSweTaskResults results={[malformed]} />)).not.toThrow();
    expect(renderToStaticMarkup(<DeepSweTaskResults results={[malformed]} />)).toContain('partial —');
  });
});
