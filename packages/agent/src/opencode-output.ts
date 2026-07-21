import { logger } from './logger.js';

interface OpencodeEvent {
  type: string;
  part?: { text?: string };
  input?: number;
  output?: number;
  error?: string;
}

/**
 * Parse opencode JSONL output and extract the final model text response.
 *
 * opencode --format json emits newline-delimited JSON events:
 *   {"type":"text","part":{"text":"..."}}
 *   {"type":"step_finish","input":1234,"output":567}
 *   {"type":"tool_use","tool":"edit_file","status":"success"}
 *   {"type":"error","error":"something went wrong"}
 *
 * We extract `text` events, log token usage from `step_finish`, and discard
 * everything else (tool_use, step_start noise).
 */
export function extractOpencodeResult(raw: string): string {
  const lines = raw.split('\n').filter((l) => l.trim());
  const textParts: string[] = [];

  for (const line of lines) {
    let event: OpencodeEvent;
    try {
      event = JSON.parse(line) as OpencodeEvent;
    } catch {
      logger.warn('opencode: skipping malformed JSONL line', { line: line.slice(0, 200) });
      continue;
    }

    switch (event.type) {
      case 'text':
        if (event.part?.text) textParts.push(event.part.text);
        break;
      case 'step_finish':
        if (event.input != null || event.output != null) {
          logger.info('opencode: step finished', { tokensIn: event.input, tokensOut: event.output });
        }
        break;
      case 'error':
        logger.warn('opencode: error event', { error: event.error });
        break;
      default:
        // tool_use, step_start, etc — discard
        break;
    }
  }

  // Fallback: if no text events found, return raw output
  if (textParts.length === 0) {
    logger.warn('opencode: no text events found in output, returning raw');
    return raw;
  }

  return textParts.join('\n');
}
