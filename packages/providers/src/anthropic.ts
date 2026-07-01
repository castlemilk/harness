import type { Provider, ProviderConfig, SendOptions } from '@omega/core';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

export class AnthropicProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
    });
    if (!res.ok) return [this.config.defaultModel];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return data.data?.map((m) => m.id) ?? [this.config.defaultModel];
  }

  async send(prompt: string, opts?: SendOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts?.model ?? this.config.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    };
    if (opts?.system) body.system = opts.system;
    if (opts?.temperature !== undefined) body.temperature = opts.temperature;

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.find((c) => c.type === 'text')?.text ?? '';
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    };
  }
}
