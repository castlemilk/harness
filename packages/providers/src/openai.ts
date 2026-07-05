import type { Provider, ProviderConfig, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function extractUsage(data: unknown): UsageInfo | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const usage = (data as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return undefined;
  const usageRecord = usage as Record<string, unknown>;
  const promptTokens =
    typeof usageRecord.prompt_tokens === 'number'
      ? usageRecord.prompt_tokens
      : typeof usageRecord.promptTokens === 'number'
        ? usageRecord.promptTokens
        : undefined;
  const completionTokens =
    typeof usageRecord.completion_tokens === 'number'
      ? usageRecord.completion_tokens
      : typeof usageRecord.completionTokens === 'number'
        ? usageRecord.completionTokens
        : undefined;
  const totalTokens =
    typeof usageRecord.total_tokens === 'number'
      ? usageRecord.total_tokens
      : typeof usageRecord.totalTokens === 'number'
        ? usageRecord.totalTokens
        : undefined;
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

export class OpenAIProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  protected get baseUrl(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  protected readonly supportsTemperature: boolean = true;

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
        ...(this.supportsTemperature && opts?.temperature !== undefined
          ? { temperature: opts.temperature }
          : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status.toString()} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: unknown[] } }[];
      usage?: Record<string, unknown>;
    };
    opts?.onUsage?.(extractUsage(data) ?? {});
    return data.choices?.[0]?.message?.content ?? '';
  }

  async sendWithTools(prompt: string, tools: ToolDefinition[], opts?: SendOptions): Promise<string> {
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
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
        parallel_tool_calls: false,
        ...(this.supportsTemperature && opts?.temperature !== undefined
          ? { temperature: opts.temperature }
          : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI tools request failed: ${res.status.toString()} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          tool_calls?: {
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
      usage?: Record<string, unknown>;
    };
    opts?.onUsage?.(extractUsage(data) ?? {});
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const normalized = toolCalls
        .map((tc) => ({
          id: tc.id ?? '',
          name: tc.function?.name ?? '',
          arguments: (() => {
            try {
              return JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
            } catch {
              return {};
            }
          })(),
        }))
        .filter((tc) => tc.id && tc.name);
      return JSON.stringify({ tool_calls: normalized });
    }
    return message?.content ?? '';
  }

  protected authHeaders(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}
