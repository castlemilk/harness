/**
 * Metrics from `agy --output-format json`.
 *
 * agy has no `/usage` API to query and reports no cost, but its print-mode JSON
 * envelope carries the token counts for the run, so usage is tracked by reading
 * what the CLI already tells us rather than by calling a vendor endpoint. Cost
 * is left to the caller, which can price the tokens once the model is known.
 *
 * Envelope (last line of stdout, after any streamed text):
 *   {"conversation_id":"…","status":"SUCCESS","response":"…","duration_seconds":3.27,
 *    "num_turns":1,
 *    "usage":{"input_tokens":16828,"output_tokens":27,"thinking_tokens":22,
 *             "cache_read_tokens":0,"total_tokens":16855}}
 */

export interface AgyMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  turns?: number;
  turnDurationMs?: number;
  /** agy's own verdict for the run. */
  status?: string;
  conversationId?: string;
}

interface AgyEnvelope {
  conversation_id?: string;
  status?: string;
  num_turns?: number;
  duration_seconds?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** Reasoning tokens; billed as output by every provider we price. */
    thinking_tokens?: number;
    cache_read_tokens?: number;
    total_tokens?: number;
  };
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Terminal escapes, inserted by the PTY around the payload. */
// eslint-disable-next-line no-control-regex -- matching ESC is the whole point
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/**
 * Recover the envelope from PTY output.
 *
 * The PTY runs at a fixed 120 columns, and the envelope is roughly twice that,
 * so it arrives hard-wrapped across several lines with CR/LF inserted mid-token.
 * A per-line JSON.parse therefore never sees it. Strip the escapes, drop the
 * line breaks the terminal added, then brace-match forward from the envelope's
 * opening key.
 */
function extractEnvelope(raw: string): AgyEnvelope | null {
  const flat = raw.replace(ANSI, '').replace(/\r?\n/g, '');
  const start = flat.lastIndexOf('{"conversation_id"');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < flat.length; i++) {
    const ch = flat[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(flat.slice(start, i + 1)) as AgyEnvelope;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseAgyMetrics(raw: string): AgyMetrics {
  const envelope = extractEnvelope(raw);
  const usage = envelope?.usage;
  if (!envelope || !usage) return {};

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const thinking = num(usage.thinking_tokens) ?? 0;

  return {
    inputTokens: input,
    // Reasoning tokens are billed at the output rate, so fold them in rather
    // than reporting a total that no price can reproduce.
    outputTokens: output === undefined ? undefined : output + thinking,
    cacheReadTokens: num(usage.cache_read_tokens),
    totalTokens: num(usage.total_tokens),
    turns: num(envelope.num_turns),
    turnDurationMs:
      envelope.duration_seconds === undefined
        ? undefined
        : Math.round(envelope.duration_seconds * 1000),
    status: envelope.status,
    conversationId: envelope.conversation_id,
  };
}
