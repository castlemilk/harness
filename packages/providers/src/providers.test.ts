import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProvider } from './index.js';
import type { ProviderConfig } from '@omega/core';

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
    expect(body.max_tokens).toBe(1024);
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

  it('throws for unknown provider kind', () => {
    expect(() =>
      createProvider({ ...openaiConfig, kind: 'unknown' as ProviderConfig['kind'] })
    ).toThrow('Unknown provider kind');
  });
});
