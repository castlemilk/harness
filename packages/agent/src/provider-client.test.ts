import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@omega/core';
import { parseProviderResponse, parseToolCalls, trackProviderEvents } from './provider-client.js';
import type { Span } from './tracer.js';
import { sendToProvider } from './provider-client.js';

function providerContext(provider: Provider, deadlineMs: number, model = 'test-model'): Parameters<typeof sendToProvider>[0] {
  const span = {
    setAttributes: vi.fn(),
    addEvent: vi.fn(),
    recordError: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    toContext: vi.fn().mockReturnValue({}),
  };
  return {
    provider,
    model,
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

describe('parseToolCalls argument aliases', () => {
  it('canonicalizes common aliases emitted by local models', () => {
    const calls = parseToolCalls(
      JSON.stringify([
        { id: 'command', name: 'run_command', arguments: { cmd: 'go test ./...' } },
        { id: 'edit', name: 'edit_file', arguments: { file: 'parser/parser.go', old_string: 'old', new_string: 'new' } },
      ])
    );

    expect(calls).toEqual([
      { id: 'command', name: 'run_command', arguments: { command: 'go test ./...' } },
      { id: 'edit', name: 'edit_file', arguments: { path: 'parser/parser.go', old_string: 'old', new_string: 'new' } },
    ]);
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
  it('caps a plain provider request at the normal 180 second limit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const send = vi.fn().mockResolvedValue('done');
    const provider = { config: { name: 'plain' }, send } as unknown as Provider;

    await sendToProvider(providerContext(provider, 1_600_000), []);

    expect(send).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      timeoutMs: 180_000,
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

  it('does not retry a provider transport timeout as another turn', async () => {
    const send = vi.fn().mockRejectedValue(new DOMException('request timed out', 'TimeoutError'));
    const provider = { config: { name: 'plain' }, send } as unknown as Provider;

    await expect(sendToProvider(providerContext(provider, Date.now() + 600_000), [])).rejects.toThrow(/timed out/i);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('provider context bounds', () => {
  it('preserves the task prompt and trims history at a user-turn boundary', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'tools' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;
    const messages = [
      { role: 'user' as const, content: 'original task' },
      ...Array.from({ length: 10 }, (_, index) => [
        {
          role: 'assistant' as const,
          content: '',
          tool_calls: [{ id: `call-${String(index)}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
        },
        { role: 'tool' as const, tool_call_id: `call-${String(index)}`, content: `result-${String(index)}` },
        { role: 'user' as const, content: `continue-${String(index)}` },
      ]).flat(),
    ];

    await sendToProvider(providerContext(provider, Date.now() + 1_600_000), messages);

    const sent = sendWithTools.mock.calls[0]?.[2] as { messages?: { role?: string; content?: string }[] };
    expect(sent.messages?.[0]).toEqual({ role: 'user', content: 'original task' });
    expect(sent.messages?.[1]?.role).toBe('user');
    expect(sent.messages?.at(-1)?.content).toBe('continue-9');
  });

  it('repairs tool-call/output pairs orphaned by truncation at mid-turn user messages', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'tools' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;
    // Forced-edit / repair user messages land between an assistant's
    // tool_calls and its tool output. When truncation cuts at such a user
    // boundary the output loses its call (Meta rejects the whole request
    // with "No function call found for function call output").
    const filler = Array.from({ length: 7 }, (_, index) => [
      { role: 'assistant' as const, content: `a-${String(index)}` },
      { role: 'user' as const, content: `continue-${String(index)}` },
    ]).flat();
    const messages = [
      { role: 'user' as const, content: 'original task' },
      { role: 'assistant' as const, content: '', tool_calls: [{ id: 'call-orphan', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'user' as const, content: 'some notice' },
      { role: 'user' as const, content: 'FORCED EDIT MODE' },
      { role: 'assistant' as const, content: 'a-mid' },
      { role: 'tool' as const, tool_call_id: 'call-orphan', content: 'result-orphan' },
      ...filler,
      { role: 'assistant' as const, content: '', tool_calls: [{ id: 'call-missing', type: 'function', function: { name: 'edit_file', arguments: '{}' } }] },
    ];

    await sendToProvider(providerContext(provider, Date.now() + 1_600_000), messages);

    const sent = (sendWithTools.mock.calls[0]?.[2] as { messages?: { role?: string; tool_call_id?: string; tool_calls?: { id?: string }[]; content?: string }[] }).messages ?? [];
    const callIds = new Set(sent.flatMap((m) => (m.tool_calls ?? []).map((tc) => tc.id)));
    const toolIds = new Set(sent.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
    // Orphaned output dropped; no tool message without its call.
    for (const id of toolIds) expect(callIds.has(id)).toBe(true);
    // Orphaned call given a synthetic output so strict providers accept the history.
    expect(toolIds.has('call-missing')).toBe(true);
  });

  it('trims older tool results while preserving the recent conversation window', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'tools' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;
    const oldOutput = 'o'.repeat(5_000);
    const recentOutput = 'r'.repeat(5_000);
    const paired = (id: string, content: string) => [
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      },
      { role: 'tool' as const, tool_call_id: id, content },
    ];
    const messages = [
      ...Array.from({ length: 5 }, (_, index) => paired(`old-${String(index)}`, oldOutput)).flat(),
      ...Array.from({ length: 6 }, (_, index) => paired(`recent-${String(index)}`, recentOutput)).flat(),
    ];

    await sendToProvider(providerContext(provider, Date.now() + 1_600_000), messages);

    const sent = sendWithTools.mock.calls[0]?.[2] as { messages?: { content?: string }[] };
    expect(sent.messages?.[1]?.content).toContain('[truncated]');
    expect(sent.messages?.[9]?.content).toContain('[truncated]');
    expect(sent.messages?.[17]?.content).toBe(recentOutput);
    expect(sent.messages?.[21]?.content).toBe(recentOutput);
  });

  it('bounds reasoning from older assistant turns as well as tool output', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'tools' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;

    await sendToProvider(providerContext(provider, Date.now() + 1_600_000), [
      {
        role: 'assistant',
        content: 'old',
        reasoning_content: 'x'.repeat(5_000),
        tool_calls: [{ id: 'old', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'old', content: 'result' },
      { role: 'assistant', content: 'recent', reasoning_content: 'y'.repeat(5_000) },
    ]);

    const sent = sendWithTools.mock.calls[0]?.[2] as { messages?: { reasoning_content?: string }[] };
    expect(sent.messages?.[0]?.reasoning_content).toContain('[truncated]');
    expect(sent.messages?.[2]?.reasoning_content).toContain('[truncated]');
  });

  it('sends only the tools permitted by the current agent phase', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'tools' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;

    await sendToProvider(providerContext(provider, Date.now() + 1_600_000), [], undefined, new Set(['finish']));

    expect((sendWithTools.mock.calls[0]?.[1] as { name: string }[]).map((tool) => tool.name)).toEqual(['finish']);
  });

  it('keeps the full tool window for smaller MLX models', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'ollama', kind: 'ollama' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;

    await sendToProvider(
      providerContext(provider, Date.now() + 1_600_000, 'qwen3.8:27b-mlx-64k'),
      [],
      undefined,
      new Set(['edit_file', 'write_file', 'edit_lines', 'apply_patch', 'read_file']),
    );

    const names = (sendWithTools.mock.calls[0]?.[1] as { name: string }[]).map((tool) => tool.name);
    expect(names).toHaveLength(5);
    expect(names).toEqual(expect.arrayContaining([
      'edit_file',
      'write_file',
      'edit_lines',
      'apply_patch',
      'read_file',
    ]));
  });

  it('keeps large MLX recovery windows to an exact read and line edit', async () => {
    const sendWithTools = vi.fn().mockResolvedValue('done');
    const provider = {
      config: { name: 'ollama', kind: 'ollama' },
      send: vi.fn(),
      sendWithTools,
    } as unknown as Provider;

    await sendToProvider(
      providerContext(provider, Date.now() + 1_600_000, 'qwen3.8-flash-next:125b-mlx'),
      [],
      undefined,
      new Set(['read_file', 'edit_file', 'edit_lines', 'apply_patch', 'write_file']),
    );

    expect((sendWithTools.mock.calls[0]?.[1] as { name: string }[]).map((tool) => tool.name)).toEqual([
      'read_file',
      'edit_lines',
    ]);
  });
});
