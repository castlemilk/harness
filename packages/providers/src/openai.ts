import type { Provider, ProviderConfig, SendOptions, ToolDefinition, UsageInfo, Capability, ReasoningEffort } from '@omega/core';
import { refreshAccessToken } from './oauth.js';
import { fetchWithRetry } from './fetch-retry.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function extractUsage(data: unknown): UsageInfo | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const usage = (data as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return undefined;
  const usageRecord = usage as Record<string, unknown>;
  // Chat Completions API: prompt_tokens / completion_tokens / total_tokens.
  // Responses API + Codex: input_tokens / output_tokens / total_tokens.
  const readNum = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = usageRecord[k];
      if (typeof v === 'number') return v;
    }
    return undefined;
  };
  const promptTokens = readNum('prompt_tokens', 'promptTokens', 'input_tokens');
  const completionTokens = readNum('completion_tokens', 'completionTokens', 'output_tokens');
  const totalTokens = readNum('total_tokens', 'totalTokens');
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

  protected readonly supportsTemperature: boolean = true;

  /** Capability entry matching the model name, if the provider declares one. */
  protected capabilityFor(model?: string): Capability | undefined {
    const name = model ?? this.config.defaultModel;
    return this.config.capabilities.find((c) => c.name === name);
  }

  /**
   * Thinking-mode config for the requested model. Providers like DeepSeek run
   * reasoning models that (a) must receive `thinking` + `reasoning_effort`,
   * and (b) reject/ignore `temperature` while thinking.
   */
  protected thinkingFor(model?: string): { enabled: boolean; effort: ReasoningEffort } | undefined {
    const cap = this.capabilityFor(model);
    if (!cap?.thinking) return undefined;
    return { enabled: true, effort: cap.reasoningEffort ?? 'high' };
  }

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
      // Token refresh failed — mark as expired so callers get a clear signal
      this.config.tokenExpiresAt = 0;
      throw new Error(`Token refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listModels(): Promise<string[]> {
    await this.ensureTokenFresh();
    if (this.isOAuth) {
      const res = await fetchWithRetry(
        `${CODEX_BASE_URL}/models?client_version=1.0.0`,
        { headers: this.authHeaders() },
        'Codex models',
        { maxRetries: 1 },
      );
      if (!res.ok) return [this.config.defaultModel];
      const data = (await res.json()) as { models?: { slug: string }[] };
      return data.models?.map((m) => m.slug) ?? [this.config.defaultModel];
    }
    const res = await fetchWithRetry(
      `${this.baseUrl}/models`,
      { headers: this.authHeaders() },
      'OpenAI models',
      { maxRetries: 1 },
    );
    if (!res.ok) return [this.config.defaultModel];
    const data = (await res.json()) as { data?: { id: string }[] };
    return data.data?.map((m) => m.id) ?? [this.config.defaultModel];
  }

  private buildMessages(prompt: string, opts?: SendOptions): { role: string; content?: string; reasoning_content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] {
    if (opts?.messages && opts.messages.length > 0) {
      const hasSystem = opts.messages.some((m) => m.role === 'system');
      const msgs = opts.messages.map((m) => {
        const base: { role: string; content: string; reasoning_content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string } = {
          role: m.role,
          content: m.content ?? '',
        };
        // Reasoning models require the CoT to be echoed back across tool-call
        // turns so the next request can continue the same reasoning chain.
        if (m.reasoning_content && m.role === 'assistant') {
          base.reasoning_content = m.reasoning_content;
        }
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
    const model = opts?.model ?? this.config.defaultModel;
    opts?.onEvent?.({ type: 'request', model, attempt: 1 });
    const thinking = this.thinkingFor(model);
    const res = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          model,
          messages: this.buildMessages(prompt, opts),
          ...(thinking
            ? { thinking: { type: 'enabled' }, reasoning_effort: thinking.effort }
            : this.supportsTemperature && opts?.temperature !== undefined
              ? { temperature: opts.temperature }
              : {}),
        }),
      },
      'OpenAI',
      {
        timeoutMs: opts?.timeoutMs,
        maxRetries: opts?.maxRetries,
        onRetry: (event) => opts?.onEvent?.({ type: 'retry', model, retryAttempt: event.attempt, ...event }),
      },
    );
    if (!res.ok) {
      opts?.onEvent?.({ type: 'error', model, status: res.status });
      const body = await res.text().catch(() => '');
      const prefix = res.status === 401 || res.status === 403
        ? 'CREDENTIAL_ERROR: '
        : 'OpenAI request failed: ';
      throw new Error(`${prefix}${res.status.toString()} ${res.statusText} — ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: unknown[] } }[];
      usage?: Record<string, unknown>;
    };
    opts?.onEvent?.({ type: 'response', model, status: res.status });
    opts?.onUsage?.(extractUsage(data) ?? {});
    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Alternative tool-capable models from this provider's declared
   * capabilities, excluding the one that just failed.
   *
   * Free-tier pools make this necessary rather than nice: OpenRouter's
   * `:free` variants share upstream provider quota, and a single model can
   * stay 429-rate-limited for minutes while its siblings still answer.
   * OpenRouter's own 429 remedy is "route to another model" — the provider
   * already declares which models those are.
   *
   * Rotation only triggers when the primary model is exhausted THROUGH the
   * retry loop (a sustained 429, not a transient blip — those retry in
   * place), and tries at most two alternatives before giving up.
   */
  private fallbackModelsForRotation(failed: string | undefined): string[] {
    return this.config.capabilities
      .filter((c) => c.supportsTools !== false && c.name !== failed)
      .map((c) => c.name)
      .slice(0, 2);
  }

  async sendWithTools(prompt: string, tools: ToolDefinition[], opts?: SendOptions): Promise<string> {
    await this.ensureTokenFresh();
    if (this.isOAuth) {
      return this.sendCodex(prompt, opts, tools);
    }
    const primary = opts?.model ?? this.config.defaultModel;
    const candidates = [primary, ...this.fallbackModelsForRotation(primary)];

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      opts?.onEvent?.({ type: 'request', model, attempt: i + 1 });
      if (i > 0) {
        console.warn(
          `OpenAI tools: model "${primary}" is rate-limited — rotating to "${model}" (${String(i)}/${String(candidates.length - 1)})`,
        );
      }
      const thinking = this.thinkingFor(model);
      const requestBody = JSON.stringify({
        model,
        messages: this.buildMessages(prompt, opts),
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
        parallel_tool_calls: false,
        ...(thinking
          ? { thinking: { type: 'enabled' }, reasoning_effort: thinking.effort }
          : this.supportsTemperature && opts?.temperature !== undefined
            ? { temperature: opts.temperature }
            : {}),
      });
      const res = await fetchWithRetry(
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
        {
          timeoutMs: opts?.timeoutMs,
          maxRetries: opts?.maxRetries,
          onRetry: (event) => opts?.onEvent?.({ type: 'retry', model, retryAttempt: event.attempt, ...event }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: {
            message?: {
              content?: string;
              reasoning_content?: string;
              tool_calls?: {
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
          usage?: Record<string, unknown>;
        };
        opts?.onEvent?.({ type: 'response', model, status: res.status });
        opts?.onUsage?.(extractUsage(data) ?? {});
        const message = data.choices?.[0]?.message;
        // A rotation is invisible to the caller's telemetry — the run says it
        // used the pinned model — so the fact must at least be recoverable
        // from logs, on every turn it happened.
        if (model !== primary) {
          console.warn(`OpenAI tools: request served by rotated model "${model}"`);
        }
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
          // Echo the chain-of-thought back so reasoning models (DeepSeek thinking)
          // can continue the same reasoning chain on the next tool-call turn.
          return JSON.stringify({
            tool_calls: normalized,
            reasoning_content: message.reasoning_content ?? '',
          });
        }
        return message?.content ?? '';
      }

      const body = await res.text().catch(() => '');
      const canRotate = res.status === 429 && i < candidates.length - 1;
      if (!canRotate) {
        opts?.onEvent?.({ type: 'error', model, status: res.status });
      }
      if (!canRotate) {
        let parsedBody: { messages?: { role?: string; content?: string; tool_calls?: { id?: string }[]; tool_call_id?: string }[] } = {};
        try {
          parsedBody = JSON.parse(body) as typeof parsedBody;
        } catch {
          // ignore parse errors
        }
        const summary = JSON.stringify(
          (parsedBody.messages ?? []).map((m) => ({
            role: m.role,
            contentLen: m.content?.length ?? 0,
            toolCallIds: m.tool_calls?.map((tc) => tc.id),
            toolCallId: m.tool_call_id,
          }))
        );
        console.error('OpenAI tools response summary:', summary);
        const prefix = res.status === 401 || res.status === 403
          ? 'CREDENTIAL_ERROR: '
          : 'OpenAI tools request failed: ';
        throw new Error(`${prefix}${res.status.toString()} ${res.statusText} — ${body.slice(0, 500)}`);
      }
      opts?.onEvent?.({
        type: 'rotation',
        model,
        nextModel: candidates[i + 1] ?? model,
        rotation: i + 1,
      });
      // 429 with another candidate: loop rotates. The retry loop inside
      // fetchWithRetry already honored Retry-After; a model that is still
      // rate-limited after 8 spread attempts is pool-saturated, and waiting
      // longer on it just burns the shared budget its siblings need.
    }
    // Unreachable: the loop returns or throws on every path.
    throw new Error('OpenAI tools: no model candidates available');
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
              arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
            });
          }
          continue;
        }
        items.push({
          type: 'function_call_output',
          call_id: m.tool_call_id ?? '',
          output: m.content ?? '',
        });
        continue;
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

    const res = await fetchWithRetry(
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
    if (!res.body) {
      throw new Error('Codex SSE response has no body');
    }
    const reader = res.body.getReader();
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
          const delta = typeof data.delta === 'string' ? data.delta : '';
          text += delta;
          break;
        }
        case 'response.output_item.added': {
          const item = data.item as Record<string, unknown> | undefined;
          if (item?.type === 'function_call') {
            currentToolCall = {
              id: typeof item.id === 'string' ? item.id : '',
              name: typeof item.name === 'string' ? item.name : '',
              arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
            };
          }
          break;
        }
        case 'response.output_item.done': {
          const item = data.item as Record<string, unknown> | undefined;
          if (item?.type === 'function_call' && currentToolCall) {
            const argsStr = typeof item.arguments === 'string' ? item.arguments : currentToolCall.arguments;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(argsStr) as Record<string, unknown>;
            } catch {
              parsed = {};
            }
            toolCalls.push({
              id: currentToolCall.id,
              name: typeof item.name === 'string' ? item.name : currentToolCall.name,
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

    let readResult = await reader.read();
    while (!readResult.done) {
      buffer += decoder.decode(readResult.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        processLine(line);
      }
      readResult = await reader.read();
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
