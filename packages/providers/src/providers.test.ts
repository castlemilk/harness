import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProvider } from './index.js';
import { warmupProvider } from './warmup.js';
import type { ProviderConfig, Provider, ProviderEvent } from '@omega/core';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openaiConfig: ProviderConfig = {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    apiKey: 'sk-test',
    defaultModel: 'gpt-4o',
    capabilities: [],
    enabled: true,
  };

  it('creates an OpenAI provider and sends a chat request', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Hello' } }] }));
    const provider = createProvider(openaiConfig);
    const result = await provider.send('hi');
    expect(result).toBe('Hello');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        body: expect.stringContaining('gpt-4o'),
      })
    );
  });

  it('passes maxOutputTokens and reports the OpenAI finish reason', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }));
    const onFinishReason = vi.fn();
    await createProvider(openaiConfig).send('hi', { maxOutputTokens: 32, onFinishReason });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(32);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(onFinishReason).toHaveBeenCalledWith('length', {
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });

  it('uses max_completion_tokens for gpt-5 models', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    await createProvider(openaiConfig).send('hi', { model: 'gpt-5-mini', maxOutputTokens: 16 });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(16);
    expect(body.max_tokens).toBeUndefined();
  });

  it('lists OpenAI models', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5' }] }));
    const models = await createProvider(openaiConfig).listModels();
    expect(models).toEqual(['gpt-4o', 'gpt-3.5']);
  });

  it('falls back to default model when list endpoint fails', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 500));
    const models = await createProvider(openaiConfig).listModels();
    expect(models).toEqual(['gpt-4o']);
  });

  const anthropicConfig: ProviderConfig = {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    apiKey: 'sk-ant-test',
    defaultModel: 'claude-3',
    capabilities: [],
    enabled: true,
  };

  it('creates an Anthropic provider and sends a message', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'Hi there' }] }));
    const provider = createProvider(anthropicConfig);
    const result = await provider.send('hello', { system: 'You are helpful', temperature: 0.5 });
    expect(result).toBe('Hi there');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.system).toBe('You are helpful');
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(4096);
  });

  it('passes maxOutputTokens and reports the Anthropic stop reason', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      content: [{ type: 'text', text: 'truncated' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 2 },
    }));
    const onFinishReason = vi.fn();
    await createProvider(anthropicConfig).send('hello', { maxOutputTokens: 64, onFinishReason });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(64);
    expect(onFinishReason).toHaveBeenCalledWith('max_tokens', {
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });

  const ollamaConfig: ProviderConfig = {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    defaultModel: 'llama3',
    capabilities: [],
    enabled: true,
  };

  it('creates an Ollama provider and sends a chat request', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ message: { content: 'Howdy' } }));
    const provider = createProvider(ollamaConfig);
    const result = await provider.send('hey');
    expect(result).toBe('Howdy');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":false'),
      })
    );
  });

  it('passes maxOutputTokens and reports the Ollama done reason', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      message: { content: 'truncated' },
      done_reason: 'length',
      prompt_eval_count: 5,
      eval_count: 2,
    }));
    const onFinishReason = vi.fn();
    await createProvider(ollamaConfig).send('hey', { maxOutputTokens: 3, onFinishReason });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.options.num_predict).toBe(3);
    expect(onFinishReason).toHaveBeenCalledWith('length', expect.objectContaining({
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    }));
  });

  it('uses OLLAMA_BASE_URL for a local relay over the stored provider URL', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ message: { content: 'Relayed' } }));
    const previous = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11435';
    try {
      await createProvider({ ...ollamaConfig, baseUrl: 'http://127.0.0.1:11434' }).send('hey');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:11435/api/chat',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      if (previous === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = previous;
    }
  });

  it('uses OLLAMA_BASE_URL for Ollama warmup probes', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: 'llama3' }] }))
      .mockResolvedValueOnce(jsonResponse({ message: { content: 'pong' } }));
    const previous = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11435';
    try {
      await warmupProvider({ ...ollamaConfig, baseUrl: 'http://127.0.0.1:11434' });
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11435/api/tags');
      expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://127.0.0.1:11435/api/chat');
    } finally {
      if (previous === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = previous;
    }
  });

  it.each(['send', 'sendWithTools'] as const)('honors request timeout for Ollama %s', async (method) => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      fetchSpy.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
      }));
      const provider = createProvider(ollamaConfig);
      const request = method === 'send'
        ? provider.send('hey', { timeoutMs: 2_500, maxRetries: 0 })
        : provider.sendWithTools?.('hey', [], { timeoutMs: 2_500, maxRetries: 0 });
      const rejection = expect(request).rejects.toThrow();

      await vi.advanceTimersByTimeAsync(2_500);
      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying an Ollama request when the caller aborts', async () => {
    const controller = new AbortController();
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const request = createProvider(ollamaConfig).send('hey', {
      signal: controller.signal,
      timeoutMs: 120_000,
      maxRetries: 2,
    });

    controller.abort();

    await expect(request).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('enables native thinking for an Ollama tool request when requested', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      message: {
        content: '',
        thinking: 'inspect the repository first',
        tool_calls: [{ function: { name: 'think', arguments: { thought: 'inspect the repository first' } } }],
      },
    }));
    const raw = await createProvider(ollamaConfig).sendWithTools?.('hey', [], {
      model: 'qwen3.8:27b-mlx',
      thinking: true,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.think).toBe(true);
    expect(JSON.parse(raw ?? '').reasoning_content).toBe('inspect the repository first');
  });

  it('warms the exact tool conversation and reports Ollama timings', async () => {
    fetchSpy.mockImplementation(() => jsonResponse({
      message: { content: 'done' },
      prompt_eval_count: 12,
      eval_count: 3,
      prompt_eval_duration: 2_000_000_000,
      eval_duration: 500_000_000,
    }));
    const onUsage = vi.fn();
    const onEvent = vi.fn();
    const provider = createProvider({
      ...ollamaConfig,
      defaultCacheMode: 'warm-ngram',
      defaultWarmupRuns: 1,
      defaultContextTokens: 8192,
    });
    await provider.sendWithTools?.('hey', [{
      name: 'read_file',
      description: 'Read a file',
      parameters: { type: 'object' },
    }], { keepAlive: '30m', onUsage, onEvent });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const warmupBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const requestBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(warmupBody.messages.at(-1).content).toContain('ngram-cache warm');
    expect(warmupBody.tools).toEqual(requestBody.tools);
    expect(warmupBody.options).toEqual(expect.objectContaining({ num_ctx: 8192, num_predict: 1 }));
    expect(requestBody.options).toEqual(expect.objectContaining({ num_ctx: 8192 }));
    expect(requestBody.options.num_predict).toBeUndefined();
    expect(requestBody.keep_alive).toBe('30m');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      promptTokens: 12,
      completionTokens: 3,
      promptDurationS: 2,
      generationDurationS: 0.5,
      ngramCacheHitRate: 0,
    }));
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'request', model: 'llama3', attempt: 1 });
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'response', model: 'llama3', status: 200 });
  });

  it('echoes Qwen thinking in the next Ollama assistant message', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ message: { content: 'done' } }));
    await createProvider(ollamaConfig).sendWithTools?.('continue', [], {
      messages: [{
        role: 'assistant',
        content: '',
        reasoning_content: 'previous reasoning',
      }],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages[0].thinking).toBe('previous reasoning');
  });

  it('lists Ollama models', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ models: [{ name: 'llama3' }, { name: 'mistral' }] }));
    const models = await createProvider(ollamaConfig).listModels();
    expect(models).toEqual(['llama3', 'mistral']);
  });

  const geminiConfig: ProviderConfig = {
    id: 'gemini',
    name: 'Gemini',
    kind: 'gemini',
    apiKey: 'gemini-key',
    defaultModel: 'gemini-1.5-flash',
    capabilities: [],
    enabled: true,
  };

  it('creates a Gemini provider and generates content', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: 'Greetings' }] } }] })
    );
    const provider = createProvider(geminiConfig);
    const result = await provider.send('hello', { system: 'Be polite', temperature: 0.7 });
    expect(result).toBe('Greetings');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/models/gemini-1.5-flash:generateContent'),
      expect.objectContaining({ method: 'POST' })
    );
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('key=gemini-key');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.systemInstruction).toBeDefined();
    expect(body.generationConfig).toEqual({ temperature: 0.7 });
  });

  it('passes maxOutputTokens and reports the Gemini finish reason', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: 'truncated' }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
    }));
    const onFinishReason = vi.fn();
    await createProvider(geminiConfig).send('hello', { maxOutputTokens: 128, onFinishReason });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 128 });
    expect(onFinishReason).toHaveBeenCalledWith('MAX_TOKENS', {
      promptTokens: 4,
      completionTokens: 2,
      totalTokens: 6,
    });
  });

  it('lists Gemini models', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        models: [{ name: 'models/gemini-1.5-flash' }, { name: 'models/gemini-pro' }],
      })
    );
    const models = await createProvider(geminiConfig).listModels();
    expect(models).toEqual(['gemini-1.5-flash', 'gemini-pro']);
  });

  it('extends OpenAI provider for generic kind', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Generic' } }] }));
    const genericConfig: ProviderConfig = {
      id: 'generic',
      name: 'Generic',
      kind: 'generic',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'generic-key',
      defaultModel: 'llama3',
      capabilities: [],
      enabled: true,
    };
    const result = await createProvider(genericConfig).send('hi');
    expect(result).toBe('Generic');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer generic-key' }),
      })
    );
  });

  it('disables OpenRouter reasoning when thinking is explicitly false', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const openrouterConfig: ProviderConfig = {
      id: 'openrouter',
      name: 'OpenRouter',
      kind: 'generic',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
      defaultModel: 'qwen/qwen3.8-27b',
      capabilities: [],
      enabled: true,
    };
    await createProvider(openrouterConfig).send('hi', { thinking: false, temperature: 0.2 });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.temperature).toBe(0.2);
  });

  it('leaves OpenRouter reasoning untouched when thinking is not disabled', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const openrouterConfig: ProviderConfig = {
      id: 'openrouter',
      name: 'OpenRouter',
      kind: 'generic',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
      defaultModel: 'qwen/qwen3.8-27b',
      capabilities: [],
      enabled: true,
    };
    await createProvider(openrouterConfig).send('hi', { temperature: 0.2 });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.reasoning).toBeUndefined();
  });

  it('throws for unknown provider kind', () => {
    expect(() =>
      createProvider({ ...openaiConfig, kind: 'unknown' as ProviderConfig['kind'] })
    ).toThrow('Unknown provider kind');
  });
});

describe('OpenAIProvider (OAuth / Codex Responses API)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  function sseResponse(events: object[]): Response {
    const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const oauthConfig: ProviderConfig = {
    id: 'openai-oauth',
    name: 'openai-oauth',
    kind: 'openai',
    refreshToken: 'rt-test',
    apiKey: 'access-test',
    tokenExpiresAt: Date.now() + 60 * 60 * 1000,
    defaultModel: 'gpt-5.4-mini',
    capabilities: [],
    enabled: true,
  };

  it('sends Codex Responses API input without tool_calls field', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        {
          type: 'response.output_text.delta',
          delta: 'hi',
        },
        {
          type: 'response.completed',
          response: { usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
        },
      ])
    );
    const provider = createProvider(oauthConfig) as Provider & { sendWithTools: NonNullable<Provider['sendWithTools']> };
    await provider.sendWithTools('Execute the next step.', [], {
      system: 'You are helpful.',
      model: 'gpt-5.4-mini',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'What is 2+2?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              type: 'function',
              function: { name: 'think', arguments: '{"thought":"math"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'tool-1', content: 'OK' },
        { role: 'user', content: 'Now please answer.' },
      ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.instructions).toBe('You are helpful.');
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(Array.isArray(body.input)).toBe(true);
    for (const item of body.input) {
      expect(item).not.toHaveProperty('tool_calls');
      expect(item).not.toHaveProperty('tool_call_id');
    }
    const kinds = body.input.map((i: { type: string }) => i.type);
    expect(kinds).toEqual([
      'message',
      'function_call',
      'function_call_output',
      'message',
    ]);
    const fc = body.input.find((i: { type: string }) => i.type === 'function_call');
    expect(fc.call_id).toBe('tool-1');
    expect(fc.name).toBe('think');
    expect(fc.arguments).toBe('{"thought":"math"}');
    const fco = body.input.find((i: { type: string }) => i.type === 'function_call_output');
    expect(fco.call_id).toBe('tool-1');
    expect(fco.output).toBe('OK');
  });

  it('parses Codex SSE tool_call events into normalized tool calls', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc-1', name: 'think', arguments: '{}' },
        },
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            id: 'fc-1',
            name: 'think',
            arguments: '{"thought":"reasoning"}',
          },
        },
        {
          type: 'response.completed',
          response: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        },
      ])
    );
    const provider = createProvider(oauthConfig) as Provider & { sendWithTools: NonNullable<Provider['sendWithTools']> };
    const result = await provider.sendWithTools('step', [], { model: 'gpt-5.4-mini' });
    const parsed = JSON.parse(result);
    expect(parsed.tool_calls).toEqual([
      { id: 'fc-1', name: 'think', arguments: { thought: 'reasoning' } },
    ]);
  });

  it('parses Codex Responses API usage fields (input_tokens / output_tokens)', async () => {
    let captured: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
    fetchSpy.mockResolvedValue(
      sseResponse([
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 42,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 7,
              output_tokens_details: {},
              total_tokens: 49,
            },
          },
        },
      ])
    );
    const provider = createProvider(oauthConfig) as Provider & { sendWithTools: NonNullable<Provider['sendWithTools']> };
    await provider.sendWithTools('step', [], {
      model: 'gpt-5.4-mini',
      onUsage: (u) => {
        captured = u;
      },
    });
    expect(captured).toEqual({ promptTokens: 42, completionTokens: 7, totalTokens: 49 });
  });

  it('passes max_output_tokens and reports the Codex Responses stop reason', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          },
        },
      ])
    );
    const onFinishReason = vi.fn();
    const provider = createProvider(oauthConfig) as Provider & { sendWithTools: NonNullable<Provider['sendWithTools']> };
    await provider.sendWithTools('step', [], { model: 'gpt-5.4-mini', maxOutputTokens: 16, onFinishReason });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_output_tokens).toBe(16);
    expect(onFinishReason).toHaveBeenCalledWith('max_output_tokens', {
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });
});

describe('free-tier model rotation (sendWithTools)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const freeConfig: ProviderConfig = {
    id: 'openrouter',
    name: 'openrouter',
    kind: 'generic',
    apiKey: 'sk-or-test',
    defaultModel: 'a:free',
    capabilities: [
      { name: 'a:free', level: 'advanced', supportsTools: true },
      { name: 'b:free', level: 'advanced', supportsTools: true },
      { name: 'c:free', level: 'capable', supportsTools: true },
    ],
    enabled: true,
  };

  const tools = [{ name: 'finish', description: 'finish the task', parameters: { type: 'object' } }];

  function rateLimited(status = 429): Response {
    // Retry-After: 0 keeps fetchWithRetry's in-loop retries instant so the
    // test exercises rotation policy, not wall-clock backoff.
    return new Response(JSON.stringify({ error: { message: 'upstream error' } }), {
      status,
      headers: { 'Retry-After': '0' },
    });
  }

  function toolResponse(model: string): Response {
    return jsonResponse({
      model,
      choices: [
        { message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'finish', arguments: '{"success":true}' } }] } },
      ],
    });
  }

  /** A mock that records every requested model, in order. */
  function recordingMock(respond: (model: string) => Response): {
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
    requestedModels: string[];
  } {
    const requestedModels: string[] = [];
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      return respond(body.model);
    });
    return { fetch: fn, requestedModels };
  }

  /** The tool-send method, guarded the way the agent's planner guards it. */
  function toolSender(config: ProviderConfig): NonNullable<Provider['sendWithTools']> {
    const provider: Provider = createProvider(config);
    if (!provider.sendWithTools) {
      throw new Error('expected a tool-capable provider');
    }
    return provider.sendWithTools.bind(provider);
  }

  it('rotates to a sibling model when the primary is persistently rate-limited', async () => {
    const mock = recordingMock((model) => (model === 'a:free' ? rateLimited() : toolResponse(model)));
    vi.stubGlobal('fetch', mock.fetch);
    const events: ProviderEvent[] = [];

    const out = await toolSender(freeConfig)('go', tools, { model: 'a:free', onEvent: (event) => events.push(event) });

    // The caller's contract is unchanged: normalized tool_calls, arguments parsed.
    expect(out).toContain('"name":"finish"');
    expect(mock.requestedModels.slice(0, 1)).toEqual(['a:free']);
    expect(mock.requestedModels.some((m) => m === 'b:free')).toBe(true);
    expect(mock.requestedModels.every((m) => ['a:free', 'b:free', 'c:free'].includes(m))).toBe(true);
    expect(events.some((event) => event.type === 'retry' && event.status === 429)).toBe(true);
    expect(events).toContainEqual({ type: 'rotation', model: 'a:free', nextModel: 'b:free', rotation: 1 });
    expect(events).toContainEqual({ type: 'response', model: 'b:free', status: 200 });
  });

  it('gives up after the declared alternatives, with the upstream status in the error', async () => {
    const mock = recordingMock(() => rateLimited());
    vi.stubGlobal('fetch', mock.fetch);

    await expect(
      toolSender(freeConfig)('go', tools, { model: 'a:free' })
    ).rejects.toThrow(/429/);
    // Primary + at most two alternatives were tried, not one and not more.
    expect(new Set(mock.requestedModels).size).toBe(3);
  });

  it('does not rotate on non-429 failures — a 500 is a bug, not a busy pool', async () => {
    const mock = recordingMock(() => rateLimited(500));
    vi.stubGlobal('fetch', mock.fetch);

    await expect(
      toolSender(freeConfig)('go', tools, { model: 'a:free' })
    ).rejects.toThrow(/500/);
    expect(new Set(mock.requestedModels)).toEqual(new Set(['a:free']));
  });
});
