import type { Provider, ProviderConfig, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';
import { fetchWithRetry } from './fetch-retry.js';
import { createHash } from 'node:crypto';

const DEFAULT_BASE_URL = 'http://localhost:11434';

// Local endpoint: if the server is down, fail fast rather than backing off
// for minutes.
const OLLAMA_RETRY = { maxRetries: 2 } as const;

interface OllamaToolResponse {
  message?: {
    content?: string | null;
    thinking?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
};

export class OllamaProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    // The process-level override is used for local relays such as Token
    // Horizon, even when the persisted provider row still points at Ollama.
    return (process.env.OLLAMA_BASE_URL ?? this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private thinkingEnabled(model: string, opts?: SendOptions): boolean {
    if (opts?.thinking !== undefined) return opts.thinking;
    return this.config.capabilities.find((cap) => cap.name === model)?.thinking === true;
  }

  private resolveCacheMode(opts?: SendOptions): 'cold' | 'warm-prefix' | 'warm-ngram' {
    return opts?.cacheMode ?? this.config.defaultCacheMode ?? 'cold';
  }

  private resolveWarmupRuns(opts?: SendOptions): number {
    return Math.max(0, opts?.warmupRuns ?? this.config.defaultWarmupRuns ?? 1);
  }

  private buildWarmupPrompt(prompt: string, cacheMode: string, sha256: string): string {
    if (cacheMode === 'warm-prefix') return prompt;
    if (cacheMode === 'warm-ngram') {
      return prompt + `\n// ngram-cache warm ${sha256.slice(0, 8)}`;
    }
    return `harness warmup only. Do not answer the benchmark prompt. Use cache breaker ${sha256}. Reply with exactly warmup-ok.`;
  }

  private async warmup(
    model: string,
    prompt: string,
    cacheMode: 'cold' | 'warm-prefix' | 'warm-ngram',
    sha256: string,
    opts?: SendOptions,
  ): Promise<{ promptTokens?: number; promptDurationS?: number }> {
    const warmupPrompt = this.buildWarmupPrompt(prompt, cacheMode, sha256);
    const warmupOpts: SendOptions = {
      ...opts,
      messages: undefined, // warmup uses its own prompt
      cacheMode: 'cold', // prevent recursion
      warmupRuns: 0,
    };
    const result = await this.sendRaw(model, warmupPrompt, warmupOpts);
    return {
      promptTokens: result.promptTokens,
      promptDurationS: result.promptDurationS,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetchWithRetry(`${this.baseUrl}/api/tags`, undefined, 'Ollama tags', { maxRetries: 1 });
    if (!res.ok) return [this.config.defaultModel];
    const data = (await res.json()) as { models?: { name: string }[] };
    return data.models?.map((m) => m.name) ?? [this.config.defaultModel];
  }

  private buildMessages(prompt: string, opts?: SendOptions): Record<string, unknown>[] {
    if (opts?.messages && opts.messages.length > 0) {
      const hasSystem = opts.messages.some((m) => m.role === 'system');
      const msgs = opts.messages.map((m) => {
        const base: Record<string, unknown> = {
          role: m.role,
          content: m.content ?? '',
        };
        if (m.tool_calls && m.tool_calls.length > 0) {
          // Normalize back to Ollama's expected format (id, type, function wrapper).
          // Ollama rejects arguments as JSON strings; it must be a parsed object.
          base.tool_calls = m.tool_calls.map((tc: Record<string, unknown>) => {
            const fn = tc.function as { arguments?: unknown; name?: unknown } | undefined;
            const rawArgs: unknown = fn?.arguments ?? tc.arguments ?? {};
            const parsedArgs: Record<string, unknown> =
              typeof rawArgs === 'string'
                ? (() => { try { return JSON.parse(rawArgs) as Record<string, unknown>; } catch { return {}; } })()
                : (rawArgs as Record<string, unknown>);
            return {
              id: typeof tc.id === 'string' ? tc.id : '',
              type: typeof tc.type === 'string' ? tc.type : 'function',
              function: {
                name: (fn?.name as string | undefined) ?? (tc.name as string | undefined) ?? '',
                arguments: parsedArgs,
              },
            };
          });
        }
        if (m.reasoning_content && m.role === 'assistant') base.thinking = m.reasoning_content;
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

  private async sendRaw(
    model: string,
    prompt: string,
    opts?: SendOptions,
  ): Promise<{ content: string; promptTokens?: number; completionTokens?: number; promptDurationS?: number; generationDurationS?: number }> {
    const contextTokens = opts?.contextTokens ?? this.config.defaultContextTokens;
    const body: Record<string, unknown> = {
      model,
      messages: [
        ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: prompt },
      ],
      stream: false,
      ...(this.thinkingEnabled(model, opts) ? { think: true } : {}),
      options: {
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(contextTokens !== undefined ? { num_ctx: contextTokens } : {}),
      },
      ...(opts?.keepAlive !== undefined ? { keep_alive: opts.keepAlive } : {}),
    };
    const res = await fetchWithRetry(
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Ollama chat',
      {
        ...OLLAMA_RETRY,
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts?.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      },
    );
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status.toString()} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
    };
    return {
      content: data.message?.content ?? '',
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      promptDurationS: data.prompt_eval_duration !== undefined ? data.prompt_eval_duration / 1e9 : undefined,
      generationDurationS: data.eval_duration !== undefined ? data.eval_duration / 1e9 : undefined,
    };
  }

  async send(prompt: string, opts?: SendOptions): Promise<string> {
    const model = opts?.model ?? this.config.defaultModel;
    const cacheMode = this.resolveCacheMode(opts);
    const warmupRuns = this.resolveWarmupRuns(opts);

    let warmupResult: { promptTokens?: number; promptDurationS?: number } | undefined;
    if (cacheMode !== 'cold' && warmupRuns > 0) {
      const sha256 = createHash('sha256').update(prompt).digest('hex');
      for (let i = 0; i < warmupRuns; i++) {
        warmupResult = await this.warmup(model, prompt, cacheMode, sha256, opts);
      }
    }

    const result = await this.sendRaw(model, prompt, opts);
    const usage: UsageInfo = {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      promptDurationS: result.promptDurationS,
      generationDurationS: result.generationDurationS,
    };
    if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
    }
    if (warmupResult?.promptDurationS !== undefined && result.promptDurationS !== undefined && warmupResult.promptDurationS > 0) {
      usage.ngramCacheHitRate = Math.round((1.0 - result.promptDurationS / warmupResult.promptDurationS) * 10000) / 10000;
    }
    opts?.onUsage?.(usage);
    return result.content;
  }

  private buildToolBody(
    model: string,
    messages: Record<string, unknown>[],
    tools: ToolDefinition[],
    opts?: SendOptions,
    warmup = false,
  ): Record<string, unknown> {
    const contextTokens = opts?.contextTokens ?? this.config.defaultContextTokens;
    const options: Record<string, unknown> = {
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(contextTokens !== undefined ? { num_ctx: contextTokens } : {}),
      ...(warmup ? { num_predict: 1 } : {}),
    };
    return {
      model,
      messages,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      stream: false,
      ...(this.thinkingEnabled(model, opts) && !warmup ? { think: true } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
      ...(opts?.keepAlive !== undefined ? { keep_alive: opts.keepAlive } : {}),
    };
  }

  private buildToolWarmupMessages(
    messages: Record<string, unknown>[],
    cacheMode: 'warm-prefix' | 'warm-ngram',
    sha256: string,
  ): Record<string, unknown>[] {
    if (cacheMode === 'warm-prefix') return messages;

    const warmed = messages.map((message) => ({ ...message }));
    const marker = `\n// ngram-cache warm ${sha256.slice(0, 8)}`;
    for (let i = warmed.length - 1; i >= 0; i--) {
      if (warmed[i].role !== 'user') continue;
      const content = typeof warmed[i].content === 'string' ? warmed[i].content : '';
      warmed[i] = {
        ...warmed[i],
        content: `${String(content)}${marker}`,
      };
      return warmed;
    }
    return [...warmed, { role: 'user', content: marker.trim() }];
  }

  private async sendToolsRaw(
    model: string,
    messages: Record<string, unknown>[],
    tools: ToolDefinition[],
    opts?: SendOptions,
    warmup = false,
  ): Promise<OllamaToolResponse> {
    const body = JSON.stringify(this.buildToolBody(model, messages, tools, opts, warmup));
    if (!warmup) opts?.onEvent?.({ type: 'request', model, attempt: 1 });

    let res: Response;
    try {
      res = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
        'Ollama tools chat',
        {
          ...OLLAMA_RETRY,
          ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
          ...(opts?.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
          ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
          onRetry: (event) => {
            if (!warmup) opts?.onEvent?.({ type: 'retry', model, retryAttempt: event.attempt, ...event });
          },
        },
      );
    } catch (error) {
      if (!warmup) opts?.onEvent?.({ type: 'error', model });
      throw error;
    }

    if (!res.ok) {
      if (!warmup) opts?.onEvent?.({ type: 'error', model, status: res.status });
      const b = await res.text().catch(() => '');
      throw new Error(`Ollama tools request failed: ${res.status.toString()} ${res.statusText} — ${b.slice(0, 500)}`);
    }

    const data = (await res.json()) as OllamaToolResponse;
    if (!warmup) opts?.onEvent?.({ type: 'response', model, status: res.status });
    return data;
  }

  async sendWithTools(prompt: string, tools: ToolDefinition[], opts?: SendOptions): Promise<string> {
    const model = opts?.model ?? this.config.defaultModel;
    const messages = this.buildMessages(prompt, opts);
    const cacheMode = this.resolveCacheMode(opts);
    const warmupRuns = this.resolveWarmupRuns(opts);
    let warmupResult: { promptDurationS?: number } | undefined;

    if (cacheMode !== 'cold' && warmupRuns > 0) {
      const sha256 = createHash('sha256').update(JSON.stringify({ messages, tools })).digest('hex');
      const warmupMessages = this.buildToolWarmupMessages(messages, cacheMode, sha256);
      for (let i = 0; i < warmupRuns; i++) {
        const warmed = await this.sendToolsRaw(model, warmupMessages, tools, opts, true);
        warmupResult = {
          promptDurationS: warmed.prompt_eval_duration !== undefined
            ? warmed.prompt_eval_duration / 1e9
            : undefined,
        };
      }
    }

    const data = await this.sendToolsRaw(model, messages, tools, opts);
    const usage: UsageInfo = {
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      promptDurationS: data.prompt_eval_duration !== undefined ? data.prompt_eval_duration / 1e9 : undefined,
      generationDurationS: data.eval_duration !== undefined ? data.eval_duration / 1e9 : undefined,
    };
    if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
    }
    if (warmupResult?.promptDurationS !== undefined && usage.promptDurationS !== undefined && warmupResult.promptDurationS > 0) {
      usage.ngramCacheHitRate = Math.round((1.0 - usage.promptDurationS / warmupResult.promptDurationS) * 10000) / 10000;
    }
    opts?.onUsage?.(usage);

    const toolCalls = data.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const normalized = toolCalls
        .map((tc, i) => ({
          id: tc.function?.name ? `call_${tc.function.name}_${i.toString()}` : `call_${i.toString()}`,
          name: tc.function?.name ?? '',
          arguments: (() => {
            const args = tc.function?.arguments;
            if (typeof args === 'string') {
              try { return JSON.parse(args) as Record<string, unknown>; }
              catch { return {}; }
            }
            if (typeof args === 'object' && args !== null) {
              return args as Record<string, unknown>;
            }
            return {};
          })(),
        }))
        .filter((tc) => tc.name);
      return JSON.stringify({
        content: data.message?.content ?? undefined,
        reasoning_content: data.message?.thinking ?? undefined,
        tool_calls: normalized,
      });
    }
    return data.message?.content ?? '';
  }
}
