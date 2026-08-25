import { describe, expect, it } from 'vitest';
import { benchRunSchema, normalizeBenchRunResults } from './bench-runs.js';

describe('bench run request schema', () => {
  it('preserves replay source selectors and defaults variance iteration to one run', () => {
    const fromRun = benchRunSchema.parse({
      suite: 'deepswe',
      replay: { fromRunId: 'source-run-1' },
      deepswe: { tasksDir: '/tmp/deepswe-tasks' },
    });
    const fromTasks = benchRunSchema.parse({
      suite: 'deepswe',
      replay: { fromHarnessTaskIds: ['source-task-1', 'source-task-2'] },
      deepswe: { tasksDir: '/tmp/deepswe-tasks' },
    });

    expect(fromRun.replay).toEqual({ fromRunId: 'source-run-1' });
    expect(fromTasks.replay).toEqual({ fromHarnessTaskIds: ['source-task-1', 'source-task-2'] });
    expect(fromRun.varianceRuns).toBe(1);
  });

  it('requires exactly one non-empty replay source selector', () => {
    const base = { suite: 'deepswe', deepswe: { tasksDir: '/tmp/deepswe-tasks' } };

    expect(() => benchRunSchema.parse({ ...base, replay: {} })).toThrow();
    expect(() => benchRunSchema.parse({
      ...base,
      replay: { fromHarnessTaskIds: [] },
    })).toThrow();
    expect(() => benchRunSchema.parse({
      ...base,
      replay: { fromRunId: '   ' },
    })).toThrow();
    expect(() => benchRunSchema.parse({
      ...base,
      replay: { fromHarnessTaskIds: ['source-task-1', ' '] },
    })).toThrow();
    expect(() => benchRunSchema.parse({
      ...base,
      replay: { fromRunId: 'source-run-1', fromHarnessTaskIds: ['source-task-1'] },
    })).toThrow();
  });

  it('preserves an explicit variance run count', () => {
    const config = benchRunSchema.parse({
      suite: 'deepswe',
      strategy: 'variance',
      varianceRuns: 3,
      deepswe: { tasksDir: '/tmp/deepswe-tasks' },
    });

    expect(config.varianceRuns).toBe(3);
    expect(() => benchRunSchema.parse({ suite: 'deepswe', strategy: 'variance', varianceRuns: 21 })).toThrow();
  });

  it('normalizes legacy and malformed persisted result payloads', () => {
    expect(normalizeBenchRunResults(null)).toEqual([]);
    expect(normalizeBenchRunResults('null')).toEqual([]);
    expect(normalizeBenchRunResults('{"taskName":"not-an-array"}')).toEqual([]);
    expect(normalizeBenchRunResults('[null,"bad",{"evaluation":{"score":"bad"}},{"taskName":"valid","passed":false}]')).toEqual([
      { taskName: 'valid', passed: false },
    ]);
  });
});
