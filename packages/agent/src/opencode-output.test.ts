import { describe, expect, it } from 'vitest';
import {
  extractOpencodeResult,
  opencodeRunLooksAborted,
  parseOpencodeMetrics,
} from './opencode-output.js';
import * as opencodeOutput from './opencode-output.js';

/**
 * Fixtures follow the real `opencode run --format json` stream shape.
 *
 * The 1.x shapes were captured live from the 2026-08-22 deep-swe eval
 * (opencode 1.18.19, model x-preview-f-free): a healthy session ended with
 * `step_finish` reason `stop`, and the aborted case was the exact failure mode
 * that turned 55% of a benchmark run into "the model produced no patch" — the
 * gateway drops the stream, the final step_finish carries reason "unknown"
 * with no tokens, and the CLI exits 0.
 *
 * The 2.x shapes were captured live on 2026-10-16: a healthy session ends with
 * the assistant's final `text` part and no trailing `step_finish` at all.
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

/** 2.x, tool-using turn: captured live 2026-10-16 — note there is no trailing step_finish. */
const HEALTHY_V2_TOOL_RUN = [
  ev({ type: 'step_start', part: { id: 'p1' } }),
  ev({ type: 'tool_use', part: { tool: 'write', state: { status: 'completed' } } }),
  ev({ type: 'step_finish', part: { reason: 'tool-calls', tokens: { total: 200, input: 180, output: 20 } } }),
  ev({ type: 'step_start', part: { id: 'p2' } }),
  ev({ type: 'text', part: { text: 'Created `hello.txt` containing `hi`. Stopping here.' } }),
].join('\n');

/** 2.x, no tools at all: the whole run is step_start then the final text. */
const HEALTHY_V2_TEXT_ONLY = [
  ev({ type: 'step_start', part: { id: 'p1' } }),
  ev({ type: 'text', part: { text: 'ok' } }),
].join('\n');

/** Cut after a tool started but before its step_finish: the stream died mid-step. */
const ABORTED_AFTER_TOOL = [
  ev({ type: 'step_start', part: { id: 'p1' } }),
  ev({ type: 'text', part: { text: 'Working on it.' } }),
  ev({ type: 'step_start', part: { id: 'p2' } }),
  ev({ type: 'tool_use', part: { tool: 'bash', state: { status: 'running' } } }),
].join('\n');

describe('opencodeRunLooksAborted', () => {
  it('accepts a session that concluded with reason "stop"', () => {
    expect(opencodeRunLooksAborted(HEALTHY)).toBe(false);
  });

  it('accepts the 2.x terminal shape — final text part, no trailing step_finish', () => {
    expect(opencodeRunLooksAborted(HEALTHY_V2_TOOL_RUN)).toBe(false);
    expect(opencodeRunLooksAborted(HEALTHY_V2_TEXT_ONLY)).toBe(false);
  });

  it('flags a stream cut on a tool call', () => {
    expect(opencodeRunLooksAborted(ABORTED_AFTER_TOOL)).toBe(true);
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

describe('OpenCode session capture', () => {
  it('extracts the session identity even when only the first event carries it', () => {
    const extractSession = (opencodeOutput as unknown as {
      extractOpencodeSessionId?: (raw: string) => string | undefined;
    }).extractOpencodeSessionId;
    expect(extractSession).toBeTypeOf('function');
    if (!extractSession) return;

    expect(extractSession(HEALTHY)).toBe('s');
    expect(extractSession([
      'not json',
      ev({ type: 'step_start', sessionID: '' }),
      ev({ type: 'step_start', sessionID: 42 }),
    ].join('\n'))).toBeUndefined();
  });
});
