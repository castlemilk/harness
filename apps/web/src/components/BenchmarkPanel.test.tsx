import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ServerBenchRunResultRow } from './BenchmarkPanel.js';

describe('ServerBenchRunResultRow', () => {
  it('renders persisted evaluation and usage detail while tolerating legacy rows', () => {
    const detail = renderToStaticMarkup(<ServerBenchRunResultRow result={{
      taskName: 'scored task',
      harnessTaskId: 'task-1',
      passed: false,
      durationMs: 1_500,
      evaluation: {
        passed: false,
        score: 0.625,
        message: 'evaluator found mismatch',
        metrics: { f2p_passed: 2, f2p_total: 4 },
      },
      costUsd: 0.0123,
      totalTokens: 1_234,
    }} />);
    expect(detail).toContain('score 0.625');
    expect(detail).toContain('f2p 2/4');
    expect(detail).toContain('evaluator found mismatch');
    expect(detail).toContain('$0.0123');
    expect(detail).toContain('1,234 tokens');

    const legacy = renderToStaticMarkup(<ServerBenchRunResultRow result={{
      taskName: 'legacy task',
      harnessTaskId: 'task-2',
      passed: true,
      durationMs: 25,
    }} />);
    expect(legacy).toContain('legacy task');
    expect(legacy).not.toContain('undefined');
  });
});
