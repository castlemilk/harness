import { describe, expect, it } from 'vitest';
import { generateAdapter } from './generate.js';

describe('generateAdapter', () => {
  it('produces a class named from the skill with an execute method', () => {
    const code = generateAdapter({
      name: 'summarize',
      description: 'Summarize text',
      args: [{ name: 'text', type: 'string', required: true }],
      instructions: 'Summarize the following text concisely.',
    });

    expect(code).toContain('class Summarize');
    expect(code).toContain('execute(args: Record<string, unknown>): Promise<string>');
    expect(code).toContain('this.provider.send');
    expect(code).toContain("system: \"Summarize text\"");
  });

  it('sanitizes names into valid class identifiers', () => {
    const code = generateAdapter({
      name: 'text-summarize_v2',
      description: 'Summarize',
      args: [],
      instructions: 'Summarize.',
    });

    expect(code).toContain('class TextSummarizeV2');
  });
});
