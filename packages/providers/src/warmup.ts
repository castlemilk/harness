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
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const testModel = model ?? config.defaultModel ?? 'unknown';
  const start = Date.now();

  try {
    // Try a lightweight models list as a connectivity check
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    const modelCount = data?.data?.length ?? 0;

    // Now do a minimal chat completion probe to verify the model works
    const probeStart = Date.now();
    const chatRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      }),
    });

    if (!chatRes.ok) {
      const body = await chatRes.text().catch(() => '');
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Chat probe failed: ${chatRes.status}: ${body.slice(0, 200)}`,
        modelCount,
      };
    }

    return {
      ok: true,
      latencyMs: probeStart - start,
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
