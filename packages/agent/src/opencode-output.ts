import { logger } from './logger.js';

interface OpencodeEvent {
  type: string;
  sessionID?: unknown;
  part?: {
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: { status?: string; input?: unknown };
    tokens?: { total?: number; input?: number; output?: number };
  };
  input?: number;
  output?: number;
}

/** Extract the explicit OpenCode session identity from a JSONL stdout stream. */
export function extractOpencodeSessionId(raw: string): string | undefined {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as OpencodeEvent;
      if (typeof event.sessionID === 'string' && event.sessionID.trim()) {
        return event.sessionID.trim();
      }
    } catch {
      // OpenCode can interleave non-JSON diagnostics; only JSON events count.
    }
  }
  return undefined;
}

export interface OpencodeMetrics {
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  /** Agent loop steps (step_finish events) — the opencode analogue of turns. */
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Did this `opencode run` session end without the model actually finishing
 * its turn?
 *
 * A healthy session ends with a `step_finish` whose reason is `stop` (the
 * model concluded). Observed live on the free tier: the provider returns an
 * empty/broken stream mid-session, opencode emits a final `step_finish` with
 * reason `unknown` and no tokens — or nothing at all — and `opencode run`
 * EXITS 0 as if done. Recording that as "the model produced no patch" blames
 * the model for an infrastructure failure; callers should retry instead.
 */
export function opencodeRunLooksAborted(raw: string): boolean {
  let sawAnyEvent = false;
  let lastFinishReason: string | undefined;
  let lastEventType: string | undefined;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: OpencodeEvent & { part?: { reason?: string } };
    try {
      event = JSON.parse(trimmed) as OpencodeEvent & { part?: { reason?: string } };
    } catch {
      continue;
    }
    if (!event.type) continue;
    sawAnyEvent = true;
    lastEventType = event.type;
    if (event.type === 'step_finish') {
      lastFinishReason = event.part?.reason;
    }
  }
  if (!sawAnyEvent) return true; // crashed before the stream started
  if (lastEventType === 'step_start') return true; // died mid-stream
  return lastFinishReason !== 'stop';
}

export function parseOpencodeMetrics(raw: string): OpencodeMetrics {
  const metrics: OpencodeMetrics = { toolCalls: {}, totalToolCalls: 0 };

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let anyToken = false;
  let steps = 0;

  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: OpencodeEvent;
    try {
      event = JSON.parse(trimmed) as OpencodeEvent;
    } catch {
      continue;
    }

    // Token usage lives on step_finish events.
    if (event.type === 'step_finish') {
      steps += 1;
      const part = event.part ?? {};
      const t = part.tokens ?? {
        input: event.input,
        output: event.output,
      };
      if (typeof t.input === 'number' && t.input > 0) {
        anyToken = true;
        inputTokens += t.input;
      }
      if (typeof t.output === 'number' && t.output > 0) {
        anyToken = true;
        outputTokens += t.output;
      }
      if (typeof t.total === 'number' && t.total > 0) {
        anyToken = true;
        totalTokens += t.total;
      }
    } else if (event.type === 'tool_use') {
      const name = event.part?.tool;
      if (typeof name === 'string') {
        metrics.toolCalls[name] = (metrics.toolCalls[name] ?? 0) + 1;
        metrics.totalToolCalls += 1;
      }
    }
  }

  if (anyToken) {
    metrics.inputTokens = inputTokens;
    metrics.outputTokens = outputTokens;
    metrics.totalTokens = totalTokens > 0 ? totalTokens : inputTokens + outputTokens;
  }
  if (steps > 0) metrics.turns = steps;

  if (metrics.totalToolCalls === 0 && !anyToken) {
    logger.warn('opencode: no metrics (tokens or tool calls) extracted from output');
  }
  return metrics;
}

/**
 * Backward-compat: keep the simple text extractor used by the existing CLI spec.
 */
export function extractOpencodeResult(raw: string): string {
  const textParts: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: OpencodeEvent;
    try {
      event = JSON.parse(trimmed) as OpencodeEvent;
    } catch {
      continue;
    }
    if (event.type === 'text' && event.part?.text) textParts.push(event.part.text);
  }
  return textParts.length > 0 ? textParts.join('\n') : raw;
}
