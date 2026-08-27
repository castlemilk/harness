import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@omega/core';
import { parseProviderResponse, trackProviderEvents } from './provider-client.js';
import type { Span } from './tracer.js';
import { sendToProvider } from './provider-client.js';

function providerContext(provider: Provider, deadlineMs: number): Parameters<typeof sendToProvider>[0] {
  const span = {
    setAttributes: vi.fn(),
    addEvent: vi.fn(),
    recordError: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    toContext: vi.fn().mockReturnValue({}),
  };
  return {
    provider,
    model: 'test-model',
    systemPrompt: 'system',
    textToolsSystemPrompt: 'text tools',
    deadlineMs,
    tracer: { startSpan: vi.fn().mockReturnValue(span) },
    rootSpan: span,
    usage: {},
  } as unknown as Parameters<typeof sendToProvider>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('provider telemetry', () => {
  it('records retries, rotations, effective models, and counters on the span', () => {
    const span = {
      addEvent: vi.fn(),
      setAttributes: vi.fn(),
    } as unknown as Span;
    const onEvent = trackProviderEvents(span);

    onEvent({ type: 'request', model: 'glm:free', attempt: 1 });
    onEvent({ type: 'retry', model: 'glm:free', retryAttempt: 1, status: 429, waitMs: 1000 });
    onEvent({ type: 'rotation', model: 'glm:free', nextModel: 'nemotron:free', rotation: 1 });
    onEvent({ type: 'request', model: 'nemotron:free', attempt: 2 });
    onEvent({ type: 'response', model: 'nemotron:free', status: 200 });

    expect(span.addEvent).toHaveBeenCalledWith('provider.rotation', {
      model: 'glm:free',
      nextModel: 'nemotron:free',
      rotation: 1,
    });
    expect(span.setAttributes).toHaveBeenLastCalledWith(expect.objectContaining({
      effectiveModel: 'nemotron:free',
      modelsTried: ['glm:free', 'nemotron:free'],
      providerRequestCount: 2,
      providerRetryCount: 1,
      providerRateLimitRetries: 1,
      providerRotationCount: 1,
      providerLastStatus: 200,
    }));
  });
});

describe('sendToProvider request timeout', () => {
  it('caps a plain provider request at the normal 120 second limit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const send = vi.fn().mockResolvedValue('done');
    const provider = { config: { name: 'plain' }, send } as unknown as Provider;

    await sendToProvider(providerContext(provider, 1_600_000), []);

    expect(send).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      timeoutMs: 120_000,
    }));
  });

  it('gives a near-deadline tool request a five second transport floor', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'tools' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;

    await sendToProvider(providerContext(provider, 1_001_000), []);

    expect(sendWithTools).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 5_000 }),
    );
  });
});
