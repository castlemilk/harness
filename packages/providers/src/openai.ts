import type { Provider, ProviderConfig, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';
import { refreshAccessToken } from './oauth.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const MAX_RETRIES = 8;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffMs(attempt: number): number {
  const base = Math.min(2000 * 2 ** attempt, 60_000);
  return Math.floor(Math.random() * base);
}

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

  protected get isOAuth(): boolean {
    return !!this.config.refreshToken;
  }

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

  protected async ensureTokenFresh(): Promise<void> {
    const { refreshToken, tokenExpiresAt } = this.config;
    if (!refreshToken || !tokenExpiresAt) return;
    if (Date.now() < tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) return;

    try {
      const tokenResponse = await refreshAccessToken(refreshToken);
      const newExpiresAt = Date.now() + tokenResponse.expires_in * 1000;
      this.config.apiKey = tokenResponse.access_token;
      this.config.refreshToken = tokenResponse.refresh_token;
      this.config.tokenExpiresAt = newExpiresAt;
      this.config.onCredentialsUpdate?.({
        apiKey: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt: newExpiresAt,
      });
    } catch (err) {
      console.warn('Token refresh failed, continuing with existing token:', err);
    }
  }

  async listModels(): Promise<string[]> {
    await this.ensureTokenFresh();
    if (this.isOAuth) {
      const res = await this.fetchWithRetry(
        `${CODEX_BASE_URL}/models?client_version=1.0.0`,
        { headers: this.authHeaders() },
        'Codex models',
      );
      if (!res.ok) return [this.config.defaultModel];
      const data = (await res.json()) as { models?: { slug: string }[] };
      return data.models?.map((m) => m.slug) ?? [this.config.defaultModel];
    }
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
    await this.ensureTokenFresh();
    if (this.isOAuth) {
      return this.sendCodex(prompt, opts);
    }
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
    await this.ensureTokenFresh();
    if (this.isOAuth) {
      return this.sendCodex(prompt, opts, tools);
    }
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

  // --- Codex Responses API (OAuth token path) ---

  private buildCodexInput(prompt: string, opts?: SendOptions): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [];

    if (opts?.messages && opts.messages.length > 0) {
      for (const m of opts.messages) {
        if (m.role === 'system') continue;
        if (m.role === 'user') {
          items.push({
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: m.content ?? '' }],
          });
          continue;
        }
        if (m.role === 'assistant') {
          const text = m.content ?? '';
          const toolCalls = m.tool_calls ?? [];
          if (text.length > 0) {
            items.push({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text }],
            });
          }
          for (const tc of toolCalls) {
            const fn = tc.function ?? {};
            items.push({
              type: 'function_call',
              call_id: tc.id ?? '',
              name: fn.name ?? '',
              arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
            });
          }
          continue;
        }
        if (m.role === 'tool') {
          items.push({
            type: 'function_call_output',
            call_id: m.tool_call_id ?? '',
            output: m.content ?? '',
          });
          continue;
        }
      }
    } else {
      items.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      });
    }

    return items;
  }

  private async sendCodex(prompt: string, opts?: SendOptions, tools?: ToolDefinition[]): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts?.model ?? this.config.defaultModel,
      input: this.buildCodexInput(prompt, opts),
      stream: true,
      store: false,
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: false,
            })),
            tool_choice: 'auto',
          }
        : {}),
      ...(opts?.system ? { instructions: opts.system } : {}),
    };

    const res = await this.fetchWithRetry(
      `${CODEX_BASE_URL}/responses`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.authHeaders(),
        },
        body: JSON.stringify(body),
      },
      'Codex',
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Codex request failed: ${res.status.toString()} ${res.statusText} — ${errBody.slice(0, 500)}`);
    }

    const { text, toolCalls, usage } = await this.parseCodexSSE(res);

    if (usage) {
      opts?.onUsage?.(usage);
    }

    if (toolCalls.length > 0) {
      return JSON.stringify({ tool_calls: toolCalls });
    }

    return text;
  }

  private async parseCodexSSE(res: Response): Promise<{
    text: string;
    toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
    usage?: UsageInfo;
  }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let text = '';
    const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;
    let usage: UsageInfo | undefined;

    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      const raw = line.slice(6);
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (data.type) {
        case 'response.output_text.delta': {
          text += (data.delta as string) ?? '';
          break;
        }
        case 'response.output_item.added': {
          const item = data.item as Record<string, unknown> | undefined;
          if (item?.type === 'function_call') {
            currentToolCall = {
              id: (item.id as string) ?? '',
              name: (item.name as string) ?? '',
              arguments: (item.arguments as string) ?? '{}',
            };
          }
          break;
        }
        case 'response.output_item.done': {
          const item = data.item as Record<string, unknown> | undefined;
          if (item?.type === 'function_call' && currentToolCall) {
            const argsStr = (item.arguments as string) ?? currentToolCall.arguments;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(argsStr) as Record<string, unknown>;
            } catch {
              parsed = {};
            }
            toolCalls.push({
              id: currentToolCall.id,
              name: (item.name as string) ?? currentToolCall.name,
              arguments: parsed,
            });
            currentToolCall = null;
          }
          break;
        }
        case 'response.completed': {
          const response = data.response as Record<string, unknown> | undefined;
          const responseUsage = response?.usage as Record<string, unknown> | undefined;
          if (responseUsage) {
            usage = extractUsage({ usage: responseUsage });
          }
          break;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        processLine(line);
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      processLine(buffer);
    }

    return { text, toolCalls, usage };
  }

  protected authHeaders(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}
