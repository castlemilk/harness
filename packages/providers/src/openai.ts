import type { Provider, ProviderConfig, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Exponential backoff with full jitter. Sequence (base ms) for attempts 0..N:
// ~1500, 3000, 6000, 12000, 24000 — capped at 30s.
function backoffMs(attempt: number): number {
  const base = Math.min(1500 * 2 ** attempt, 30_000);
  return Math.floor(Math.random() * base);
}

// Parse a Retry-After header (seconds or HTTP-date). Returns ms or undefined.
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 60_000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  return undefined;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}


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

  // Fetch with retry on transient failures (429, 5xx, network errors). The body
  // must be a string so it is reusable across attempts. Returns the final
  // response (which may still be non-OK for non-transient or exhausted cases).
  private async fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
        const wait = backoffMs(attempt);
        console.warn(`${label}: network error, retry ${String(attempt + 1)}/${String(MAX_RETRIES)} in ${String(wait)}ms`);
        await sleep(wait);
        continue;
      }
      if (isTransientStatus(res.status) && attempt < MAX_RETRIES) {
        // Drain/discard the body so the connection can be reused.
        await res.text().catch(() => undefined);
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const wait = retryAfter ?? backoffMs(attempt);
        console.warn(`${label}: ${String(res.status)} transient, retry ${String(attempt + 1)}/${String(MAX_RETRIES)} in ${String(wait)}ms`);
        await sleep(wait);
        continue;
      }
      return res;
    }
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

  private buildMessages(prompt: string, opts?: SendOptions): { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] {
    if (opts?.messages && opts.messages.length > 0) {
      const hasSystem = opts.messages.some((m) => m.role === 'system');
      const msgs = opts.messages.map((m) => {
        const base: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string } = {
          role: m.role,
          content: m.content ?? '',
        };
        if (m.tool_calls && m.tool_calls.length > 0) {
          base.tool_calls = m.tool_calls.map((tc) => ({
            id: tc.id ?? '',
            type: tc.type ?? 'function',
            function: tc.function ?? {},
          }));
        }
        if (m.role === 'tool') {
          base.tool_call_id = m.tool_call_id ?? '';
        }
        if (m.name) base.name = m.name;
        return base;
      });
      if (opts.system && !hasSystem) {
        msgs.unshift({ role: 'system', content: opts.system });
      }
      return msgs;
    }
    return [
      ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: prompt },
    ];
  }

  async send(prompt: string, opts?: SendOptions): Promise<string> {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          model: opts?.model ?? this.config.defaultModel,
          messages: this.buildMessages(prompt, opts),
          ...(this.supportsTemperature && opts?.temperature !== undefined
            ? { temperature: opts.temperature }
            : {}),
        }),
      },
      'OpenAI',
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI request failed: ${res.status.toString()} ${res.statusText} — ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: unknown[] } }[];
      usage?: Record<string, unknown>;
    };
    opts?.onUsage?.(extractUsage(data) ?? {});
    return data.choices?.[0]?.message?.content ?? '';
  }

  async sendWithTools(prompt: string, tools: ToolDefinition[], opts?: SendOptions): Promise<string> {
    const requestBody = JSON.stringify({
      model: opts?.model ?? this.config.defaultModel,
      messages: this.buildMessages(prompt, opts),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
      parallel_tool_calls: false,
      ...(this.supportsTemperature && opts?.temperature !== undefined
        ? { temperature: opts.temperature }
        : {}),
    });
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        body: requestBody,
      },
      'OpenAI tools',
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const summary = JSON.stringify(
        JSON.parse(requestBody).messages.map((m: { role?: string; content?: string; tool_calls?: { id?: string }[]; tool_call_id?: string }) => ({
          role: m.role,
          contentLen: m.content?.length ?? 0,
          toolCallIds: m.tool_calls?.map((tc) => tc.id),
          toolCallId: m.tool_call_id,
        }))
      );
      // eslint-disable-next-line no-console
      console.error('OpenAI tools messages summary:', summary);
      throw new Error(`OpenAI tools request failed: ${res.status.toString()} ${res.statusText} — ${body.slice(0, 500)}`);
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
