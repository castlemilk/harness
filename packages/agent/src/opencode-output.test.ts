import { describe, expect, it } from 'vitest';
import {
  extractOpencodeResult,
  opencodeRunLooksAborted,
  parseOpencodeMetrics,
} from './opencode-output.js';

/**
 * Fixtures follow the real `opencode run --format json` stream shape,
 * captured live from the 2026-08-22 deep-swe eval (opencode 1.18.19,
 * model x-preview-f-free). The aborted case is the exact failure mode that
 * turned 55% of a benchmark run into "the model produced no patch": the
 * gateway drops the stream, the final step_finish carries reason "unknown"
 * with no tokens, and the CLI exits 0.
 */

const ev = (obj: object): string => JSON.stringify(obj);

const HEALTHY = [
  ev({ type: 'step_start', timestamp: 1, sessionID: 's', part: { id: 'p1' } }),
  ev({ type: 'tool_use', part: { tool: 'read', state: { status: 'completed' } } }),
  ev({ type: 'step_finish', part: { reason: 'tool-calls', tokens: { total: 200, input: 180, output: 20 } } }),
  ev({ type: 'step_start', part: { id: 'p2' } }),
  ev({ type: 'tool_use', part: { tool: 'edit', state: { status: 'completed' } } }),
  ev({ type: 'text', part: { text: 'Done — feature implemented and tests pass.' } }),
  ev({ type: 'step_finish', part: { reason: 'stop', tokens: { total: 350, input: 300, output: 50 } } }),
].join('\n');

const ABORTED_UNKNOWN = [
  ev({ type: 'step_start', part: { id: 'p1' } }),
  ev({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed' } } }),
  ev({ type: 'step_finish', part: { reason: 'tool-calls', tokens: { total: 100, input: 90, output: 10 } } }),
  ev({ type: 'step_start', part: { id: 'p2' } }),
  // The gateway died: no tokens, reason unknown, then the CLI exits 0.
  ev({ type: 'step_finish', part: { reason: 'unknown' } }),
].join('\n');

const ABORTED_MID_STREAM = [
  ev({ type: 'step_start', part: { id: 'p1' } }),
  ev({ type: 'step_finish', part: { reason: 'tool-calls', tokens: { total: 100 } } }),
  // Killed while a new stream was opening — step_start is the last event.
  ev({ type: 'step_start', part: { id: 'p2' } }),
].join('\n');

describe('opencodeRunLooksAborted', () => {
  it('accepts a session that concluded with reason "stop"', () => {
    expect(opencodeRunLooksAborted(HEALTHY)).toBe(false);
  });

  it('flags the observed gateway-drop shape: final step_finish reason "unknown"', () => {
    expect(opencodeRunLooksAborted(ABORTED_UNKNOWN)).toBe(true);
  });

  it('flags a stream that ends on step_start (killed mid-flight)', () => {
    expect(opencodeRunLooksAborted(ABORTED_MID_STREAM)).toBe(true);
  });

  it('flags an empty or non-JSON capture — the CLI crashed before streaming', () => {
    expect(opencodeRunLooksAborted('')).toBe(true);
    expect(opencodeRunLooksAborted('command not found: opencode')).toBe(true);
  });
});

describe('parseOpencodeMetrics turns', () => {
  it('counts step_finish events as turns', () => {
    const m = parseOpencodeMetrics(HEALTHY);
    expect(m.turns).toBe(2);
    expect(m.toolCalls).toEqual({ read: 1, edit: 1 });
    expect(m.totalTokens).toBe(550);
  });

  it('reports no turns for a stream with none, rather than 0', () => {
    expect(parseOpencodeMetrics('not json').turns).toBeUndefined();
  });
});

describe('extractOpencodeResult', () => {
  it('keeps the text narrative and drops the event plumbing', () => {
    expect(extractOpencodeResult(HEALTHY)).toBe('Done — feature implemented and tests pass.');
  });
});
