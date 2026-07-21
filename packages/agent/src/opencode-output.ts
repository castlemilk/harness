import { logger } from './logger.js';

interface OpencodeEvent {
  type: string;
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

export interface OpencodeMetrics {
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export function parseOpencodeMetrics(raw: string): OpencodeMetrics {
  const metrics: OpencodeMetrics = { toolCalls: {}, totalToolCalls: 0 };

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let anyToken = false;

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
