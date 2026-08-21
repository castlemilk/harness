import { describe, expect, it } from 'vitest';
import { parsePulseReport } from './pulse-engine.js';
import { estimateCostUsd, contextWindowFor, lookupModelPrice } from '@omega/core';

/**
 * The two pure pieces of the pulse engine: what we accept back from a model,
 * and what we charge for it. Both sit directly in front of money.
 */

describe('parsePulseReport', () => {
  it('reads a clean JSON report', () => {
    const report = parsePulseReport(
      '{"summary":"Swept the board, unblocked 388.","outcome":"ok","activity":"Sweeping board"}',
    );
    expect(report).toMatchObject({
      summary: 'Swept the board, unblocked 388.',
      outcome: 'ok',
      activity: 'Sweeping board',
    });
    expect(report.needsHuman).toBeUndefined();
  });

  it('recovers JSON wrapped in a code fence or surrounding prose', () => {
    expect(
      parsePulseReport('Here you go:\n```json\n{"summary":"Did the thing","outcome":"warn"}\n```')
        .summary,
    ).toBe('Did the thing');
    expect(
      parsePulseReport('Sure! {"summary":"Inline","outcome":"ok"} Hope that helps.').summary,
    ).toBe('Inline');
  });

  it('keeps an escalation when the model asks for a human', () => {
    const report = parsePulseReport(
      '{"summary":"Blocked","outcome":"warn","needsHuman":{"kind":"approval","title":"Force-push to release/v3","detail":"14 files"}}',
    );
    expect(report.needsHuman).toEqual({
      kind: 'approval',
      title: 'Force-push to release/v3',
      detail: '14 files',
    });
  });

  it('defaults an unrecognised escalation kind to a question', () => {
    const report = parsePulseReport(
      '{"summary":"x","outcome":"ok","needsHuman":{"kind":"nonsense","title":"Which way?"}}',
    );
    expect(report.needsHuman?.kind).toBe('question');
  });

  it('keeps unparseable prose as the log entry rather than discarding a paid pulse', () => {
    const report = parsePulseReport('I checked the board and everything looked fine.');
    expect(report.outcome).toBe('warn');
    expect(report.summary).toContain('everything looked fine');
  });

  it('never throws on empty, malformed or hostile input', () => {
    for (const input of ['', '   ', '{', '{"summary":}', '```json\n{\n```', 'null', '[]']) {
      expect(() => parsePulseReport(input)).not.toThrow();
      expect(parsePulseReport(input).summary.length).toBeGreaterThan(0);
    }
  });
});

describe('working memory in the report', () => {
  it('keeps a returned memory string, clamped to the cap', () => {
    const report = parsePulseReport(
      '{"summary":"Advanced the slice.","outcome":"ok","memory":"Open thread: v253 gate pending. Check the ruler verdict next pulse."}',
    );
    expect(report.memory).toBe(
      'Open thread: v253 gate pending. Check the ruler verdict next pulse.',
    );
    const long = parsePulseReport(
      `{"summary":"x","outcome":"ok","memory":"${'a'.repeat(5000)}"}`,
    );
    expect(long.memory?.length).toBe(2000);
  });

  it('distinguishes "clear my memory" from "keep it"', () => {
    // Empty string is a deliberate clear and must survive the parse…
    expect(parsePulseReport('{"summary":"x","outcome":"ok","memory":""}').memory).toBe('');
    // …absent means keep, and a non-string is not a memory.
    expect(parsePulseReport('{"summary":"x","outcome":"ok"}').memory).toBeUndefined();
    expect(parsePulseReport('{"summary":"x","outcome":"ok","memory":null}').memory).toBeUndefined();
  });
});

describe('cost estimation', () => {
  it('prices a known model from its input and output tokens', () => {
    // gpt-5-mini: $0.25/1M in, $2/1M out.
    const cost = estimateCostUsd('gpt-5-mini', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2.25, 6);
  });

  it('matches the most specific model id, not merely the first', () => {
    expect(lookupModelPrice('gpt-5-nano')?.input).toBe(0.05);
    expect(lookupModelPrice('gpt-5')?.input).toBe(1.25);
  });

  it('returns null for an unpriced model instead of pretending it was free', () => {
    // Coercing this to 0 would make budget caps stop protecting anything.
    expect(estimateCostUsd('some-unknown-model', { promptTokens: 999_999 })).toBeNull();
    expect(estimateCostUsd(null, { promptTokens: 10 })).toBeNull();
  });

  it('treats a local model as genuinely free', () => {
    expect(estimateCostUsd('llama3', { promptTokens: 5000, completionTokens: 5000 })).toBe(0);
  });

  it('falls back to a sane context window for unknown models', () => {
    expect(contextWindowFor('gpt-5-mini')).toBe(400_000);
    expect(contextWindowFor('mystery-model')).toBe(200_000);
  });
});

describe('unpriced models', () => {
  it('has no price for the Kimi coding model, so cost is unknown not zero', () => {
    // The engine refuses to run a capped harness on this, because a cap that
    // cannot be measured does not cap anything.
    expect(lookupModelPrice('moonshot-v1-32k')).toBeNull();
    expect(estimateCostUsd('moonshot-v1-32k', { promptTokens: 1000, completionTokens: 1000 }))
      .toBeNull();
  });

  it('prices the models the engine was validated against', () => {
    for (const m of ['deepseek-chat', 'glm-5.2']) {
      expect(lookupModelPrice(m), `${m} should be priced`).not.toBeNull();
    }
  });
});
