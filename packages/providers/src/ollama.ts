import type { Provider, ProviderConfig, SendOptions } from '@omega/core';

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) return [this.config.defaultModel];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) ?? [this.config.defaultModel];
  }

  async send(prompt: string, opts?: SendOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts?.model ?? this.config.defaultModel,
        messages: [
          ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: opts?.temperature !== undefined ? { temperature: opts.temperature } : undefined,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
}
