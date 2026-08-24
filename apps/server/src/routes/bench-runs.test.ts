import { describe, expect, it } from 'vitest';
import { benchRunSchema, normalizeBenchRunResults } from './bench-runs.js';

describe('bench run request schema', () => {
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
