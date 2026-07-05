import type { Provider, ProviderConfig, SendOptions, UsageInfo } from '@omega/core';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    const url = new URL(`${this.baseUrl}/models`);
    if (this.config.apiKey) url.searchParams.set('key', this.config.apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) return [this.config.defaultModel];
    const data = (await res.json()) as { models?: { name: string }[] };
    return data.models?.map((m) => m.name.replace(/^models\//, '')) ?? [this.config.defaultModel];
  }

  async send(prompt: string, opts?: SendOptions): Promise<string> {
    const model = opts?.model ?? this.config.defaultModel;
    const url = new URL(`${this.baseUrl}/models/${model}:generateContent`);
    if (this.config.apiKey) url.searchParams.set('key', this.config.apiKey);

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (opts?.system) {
      body.systemInstruction = { role: 'user', parts: [{ text: opts.system }] };
    }
    if (opts?.temperature !== undefined) {
      body.generationConfig = { temperature: opts.temperature };
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Gemini request failed: ${res.status.toString()} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    if (data.usageMetadata) {
      const usage: UsageInfo = {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
      };
      opts?.onUsage?.(usage);
    }
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  }
}
