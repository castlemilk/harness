import type { ProviderConfig } from '@omega/core';

export interface WarmupResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  modelCount?: number;
}

/**
 * Probes a provider endpoint with a minimal request to validate
 * connectivity, API key validity, and model availability.
 */
export async function warmupProvider(config: ProviderConfig, model?: string): Promise<WarmupResult> {
    const baseUrl = (
      config.kind === 'ollama'
        ? process.env.OLLAMA_BASE_URL ?? config.baseUrl ?? 'http://localhost:11434'
        : config.baseUrl ?? 'https://api.openai.com/v1'
    ).replace(/\/$/, '');
  const testModel = model ?? config.defaultModel;
  const start = Date.now();

  try {
    // Ollama uses /api/tags and /api/chat, not /models and /chat/completions
    const isOllama = config.kind === 'ollama';
    const tagsPath = isOllama ? '/api/tags' : '/models';
    const chatPath = isOllama ? '/api/chat' : '/chat/completions';

    // Try a lightweight models list as a connectivity check
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 15_000);

    const res = await fetch(`${baseUrl}${tagsPath}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body: string = await res.text().catch(() => '');
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `${String(res.status)}: ${body.slice(0, 200)}`,
      };
    }

    const data = await res.json() as { data?: { id: string }[]; models?: { name: string }[] };
    const modelCount = isOllama ? (data.models?.length ?? 0) : (data.data?.length ?? 0);

    // Now do a minimal chat completion probe to verify the model works
    // Kimi models require temperature=1, others work with 0
    const probeTemp = config.kind === 'kimi' ? 1 : 0;
    const chatBody = isOllama
      ? {
          model: testModel,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          options: { temperature: probeTemp },
        }
      : {
          model: testModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: probeTemp,
        };
    const chatRes = await fetch(`${baseUrl}${chatPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chatBody),
    });

    if (!chatRes.ok) {
      const body: string = await chatRes.text().catch(() => '');
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Chat probe failed: ${String(chatRes.status)}: ${body.slice(0, 200)}`,
        modelCount,
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      modelCount,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
