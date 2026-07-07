import type { Provider, ProviderConfig, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';

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
      throw new Error(`Ollama request failed: ${res.status.toString()} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const usage: UsageInfo = {
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
    };
    if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
    }
    opts?.onUsage?.(usage);
    return data.message?.content ?? '';
  }

  async sendWithTools(prompt: string, tools: ToolDefinition[], opts?: SendOptions): Promise<string> {
    const bodyObj: Record<string, unknown> = {
      model: opts?.model ?? this.config.defaultModel,
      messages: this.buildMessages(prompt, opts),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      stream: false,
    };
    if (opts?.temperature !== undefined) {
      bodyObj.options = { temperature: opts.temperature };
    }
    const body = JSON.stringify(bodyObj);
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const b = await res.text().catch(() => '');
      throw new Error(`Ollama tools request failed: ${res.status.toString()} ${res.statusText} — ${b.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      message?: {
        content?: string | null;
        tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
      };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const usage: UsageInfo = {
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
    };
    if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
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
      return JSON.stringify({ tool_calls: normalized });
    }
    return data.message?.content ?? '';
  }
}
