import { logger } from './logger.js';

/**
 * Parse claude-code `--output-format stream-json --verbose` output and extract
 * the metrics the harness needs:
 *
 *   - **tokens**: summed from every `assistant` `usage` block (input/output/cache)
 *   - **cost**: from the final `result` event's `total_cost_usd`
 *   - **tool calls**: counted from `assistant` content blocks with type `tool_use`,
 *     plus a count breakdown by tool name
 *   - **turns**: `num_turns` from the final `result` event
 *
 * claude-code emits one JSON object per line:
 *   {"type":"system","subtype":"init",...}
 *   {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read",...}]},"usage":{...}}
 *   {"type":"result","subtype":"success","num_turns":1,"total_cost_usd":0.0012,"usage":{...}}
 *
 * Falls back to the raw string when no usable events are found.
 */

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeAssistantMessage {
  content?: Array<{
    type: string;
    name?: string;
    [k: string]: unknown;
  }>;
  usage?: ClaudeUsage;
}

interface ClaudeResultEvent {
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  is_error?: boolean;
}

export interface ClaudeMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  turns?: number;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  durationMs?: number;
  success: boolean;
}

interface ClaudeEvent {
  type: string;
  subtype?: string;
  message?: ClaudeAssistantMessage;
  usage?: ClaudeUsage;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  is_error?: boolean;
}

export function parseClaudeCodeStreamJson(raw: string): ClaudeMetrics {
  const metrics: ClaudeMetrics = {
    toolCalls: {},
    totalToolCalls: 0,
    success: false,
  };

  let sawEvent = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let anyTokenSeen = false;

  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: ClaudeEvent;
    try {
      event = JSON.parse(trimmed) as ClaudeEvent;
    } catch {
      // Not JSON — could be a stray log line. Skip silently.
      continue;
    }
    sawEvent = true;

    if (event.type === 'assistant') {
      // Token usage comes on each assistant turn.
      const u = event.message?.usage ?? event.usage;
      if (u) {
        anyTokenSeen = true;
        inputTokens += u.input_tokens ?? 0;
        outputTokens += u.output_tokens ?? 0;
        cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
        cacheReadTokens += u.cache_read_input_tokens ?? 0;
      }
      // Count tool_use blocks.
      const blocks = event.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          metrics.toolCalls[block.name] = (metrics.toolCalls[block.name] ?? 0) + 1;
          metrics.totalToolCalls += 1;
        }
      }
    } else if (event.type === 'result') {
      const r = event as ClaudeResultEvent;
      if (typeof r.num_turns === 'number') metrics.turns = r.num_turns;
      if (typeof r.total_cost_usd === 'number') metrics.costUsd = r.total_cost_usd;
      if (typeof r.duration_ms === 'number') metrics.durationMs = r.duration_ms;
      metrics.success = !r.is_error;
      // Final usage may also appear on the result event.
      if (event.usage) {
        anyTokenSeen = true;
        inputTokens += event.usage.input_tokens ?? 0;
        outputTokens += event.usage.output_tokens ?? 0;
        cacheCreationTokens += event.usage.cache_creation_input_tokens ?? 0;
        cacheReadTokens += event.usage.cache_read_input_tokens ?? 0;
      }
    }
  }

  if (!sawEvent) {
    logger.warn('claude-code: no JSONL events found in output');
    return metrics;
  }

  if (anyTokenSeen) {
    metrics.inputTokens = inputTokens;
    metrics.outputTokens = outputTokens;
    metrics.cacheCreationTokens = cacheCreationTokens;
    metrics.cacheReadTokens = cacheReadTokens;
    metrics.totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  }

  return metrics;
}
