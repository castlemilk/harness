import { describe, expect, it } from 'vitest';
import { parseAgyMetrics } from './agy-output.js';

/** Captured verbatim from `agy -p … --output-format json`. */
const REAL = `ok
{"conversation_id":"c5baa4b4-147c-44ee-b0ae-dfee54f34da1","status":"SUCCESS","response":"ok\\n","duration_seconds":3.271563,"num_turns":1,"usage":{"input_tokens":16828,"output_tokens":27,"thinking_tokens":22,"cache_read_tokens":0,"total_tokens":16855}}`;

describe('parseAgyMetrics', () => {
  it('reads usage from a real agy envelope', () => {
    const m = parseAgyMetrics(REAL);
    expect(m.inputTokens).toBe(16828);
    // Reasoning tokens bill at the output rate, so they fold into output.
    expect(m.outputTokens).toBe(27 + 22);
    expect(m.totalTokens).toBe(16855);
    expect(m.turns).toBe(1);
    expect(m.turnDurationMs).toBe(3272);
    expect(m.status).toBe('SUCCESS');
  });

  it('recovers an envelope hard-wrapped by the 120-column PTY', () => {
    // What the PTY actually delivers: the envelope broken every 120 chars.
    const wrapped = REAL.replace(/(.{120})/g, '$1\r\n');
    const m = parseAgyMetrics(wrapped);
    expect(m.totalTokens).toBe(16855);
    expect(m.inputTokens).toBe(16828);
  });

  it('finds the envelope after noisy PTY output', () => {
    const noisy = `some ansi chatter\nnot json at all\n${REAL}`;
    expect(parseAgyMetrics(noisy).totalTokens).toBe(16855);
  });

  it('returns empty rather than throwing when there is no envelope', () => {
    for (const raw of ['', 'just prose', '{"status":"SUCCESS"}', '{broken']) {
      expect(() => parseAgyMetrics(raw)).not.toThrow();
      expect(parseAgyMetrics(raw).totalTokens).toBeUndefined();
    }
  });
});
