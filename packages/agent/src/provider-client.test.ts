import { describe, expect, it } from 'vitest';
import { parseProviderResponse } from './provider-client.js';

describe('parseProviderResponse reasoning_content', () => {
  it('extracts reasoning_content from a JSON tool_calls response', () => {
    const raw = JSON.stringify({
      content: 'Calling read_file.',
      reasoning_content: 'The user wants to know the value of X.',
      tool_calls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'README.md' } }],
    });
    const parsed = parseProviderResponse(raw);
    expect(parsed.reasoningContent).toBe('The user wants to know the value of X.');
    expect(parsed.toolCalls).toBeTruthy();
  });

  it('omits reasoningContent when absent', () => {
    const parsed = parseProviderResponse(JSON.stringify({ content: 'plain', tool_calls: [] }));
    expect(parsed.reasoningContent).toBeUndefined();
  });

  it('keeps plain text responses unaffected', () => {
    const parsed = parseProviderResponse('just some text');
    expect(parsed.content).toBe('just some text');
    expect(parsed.reasoningContent).toBeUndefined();
  });
});
