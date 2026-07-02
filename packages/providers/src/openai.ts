import type { Provider, ProviderConfig, SendOptions } from '@omega/core';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  protected get baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) return [this.config.defaultModel];
    const data = (await res.json()) as { data?: { id: string }[] };
    return data.data?.map((m) => m.id) ?? [this.config.defaultModel];
  }

  async send(prompt: string, opts?: SendOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        model: opts?.model ?? this.config.defaultModel,
        messages: [
          ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: opts?.temperature,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status.toString()} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? '';
  }

  protected authHeaders(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}
