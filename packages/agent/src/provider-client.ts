import type { Provider, ProviderEvent, ProviderTelemetry, ToolCall, ToolDefinition, SendOptions, UsageInfo } from '@omega/core';
import type { IntelligentRouter } from '@omega/router';
import { abortableOperation, abortableSleep } from './retry.js';
import { AGENT_TOOLS } from './tool-definitions.js';
import { logger } from './logger.js';
import type { Tracer, Span } from './tracer.js';
import { boundedProviderRequestTimeoutMs } from './project-utils.js';

const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));

// --- Types ---

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  reasoning_content?: string;
  tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
  tool_call_id?: string;
}

interface ProviderContext {
  provider: Provider;
  model: string;
  systemPrompt: string;
  textToolsSystemPrompt: string;
  signal?: AbortSignal;
  deadlineMs: number;
  router?: IntelligentRouter;
  tracer: Tracer;
  rootSpan: Span;
  promptContext?: string;
  usage: UsageInfo;
  providerTelemetry: ProviderTelemetry;
}

// --- Usage tracking ---

export function recordUsage(ctx: ProviderContext, usage: UsageInfo): void {
  if (usage.promptTokens !== undefined) {
    ctx.usage.promptTokens = (ctx.usage.promptTokens ?? 0) + usage.promptTokens;
  }
  if (usage.completionTokens !== undefined) {
    ctx.usage.completionTokens = (ctx.usage.completionTokens ?? 0) + usage.completionTokens;
  }
  if (usage.totalTokens !== undefined) {
    ctx.usage.totalTokens = (ctx.usage.totalTokens ?? 0) + usage.totalTokens;
  } else if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
    ctx.usage.totalTokens = (ctx.usage.totalTokens ?? 0) + usage.promptTokens + usage.completionTokens;
  }
}

export function trackProviderEvents(span: Span, telemetry?: ProviderTelemetry): (event: ProviderEvent) => void {
  const modelsTried = new Set<string>();
  let requestCount = 0;
  let retryCount = 0;
  let rateLimitRetries = 0;
  let rotationCount = 0;
  return (event) => {
    const { type, ...attributes } = event;
    span.addEvent(`provider.${type}`, attributes);
    if (event.type === 'request') {
      requestCount++;
      modelsTried.add(event.model);
      if (telemetry) telemetry.calls++;
    } else if (event.type === 'retry') {
      retryCount++;
      if (event.status === 429) rateLimitRetries++;
      modelsTried.add(event.model);
      if (telemetry) {
        telemetry.retries++;
        if (event.status === 429) telemetry.rateLimitRetries++;
      }
    } else if (event.type === 'rotation') {
      rotationCount++;
      modelsTried.add(event.model);
      modelsTried.add(event.nextModel);
      if (telemetry) telemetry.rotations++;
    } else {
      modelsTried.add(event.model);
    }
    if (telemetry) {
      telemetry.modelsTried = [...new Set([...telemetry.modelsTried, ...modelsTried])];
      telemetry.effectiveModel = event.type === 'rotation' ? event.nextModel : event.model;
      if (event.type === 'response' || event.type === 'error') telemetry.lastStatus = event.status;
    }
    span.setAttributes({
      effectiveModel: event.type === 'rotation' ? event.nextModel : event.model,
      modelsTried: [...modelsTried],
      providerRequestCount: requestCount,
      providerRetryCount: retryCount,
      providerRateLimitRetries: rateLimitRetries,
      providerRotationCount: rotationCount,
      ...(event.type === 'response' || event.type === 'error' ? { providerLastStatus: event.status } : {}),
    });
  };
}

// --- Message truncation ---

function truncateMessages(
  messages: Message[],
  maxTotal = 40,
  fullWindow = 10,
  truncateLength = 500
): Message[] {
  const cleaned = messages.filter((m) => m.role !== 'system');

  const trimContent = (m: Message): Message => {
    if (!m.content || m.content.length <= truncateLength) return m;
    return { ...m, content: `${m.content.slice(0, truncateLength)}\n... [truncated]` };
  };

  let working = cleaned;
  if (cleaned.length > maxTotal) {
    const toDrop = cleaned.length - maxTotal;
    let keepFrom = toDrop;
    while (keepFrom < cleaned.length) {
      const m = cleaned[keepFrom];
      if (m.role === 'assistant' && (keepFrom === 0 || cleaned[keepFrom - 1].role === 'user')) {
        break;
      }
      keepFrom++;
    }
    working = cleaned.slice(keepFrom);
  }

  const windowStart = Math.max(0, working.length - fullWindow);
  return working.map((m, idx) => {
    if (idx >= windowStart) return m;
    return trimContent(m);
  });
}

// --- Provider send ---

export async function sendToProvider(
  ctx: ProviderContext,
  messages: Message[],
  prompt?: string
): Promise<{ content?: string; toolCalls?: string; reasoningContent?: string }> {
  const span = ctx.tracer.startSpan('provider.send', ctx.rootSpan.toContext());
  span.setAttributes({ provider: ctx.provider.config.name, model: ctx.model });
  const onEvent = trackProviderEvents(span, ctx.providerTelemetry);

  if (ctx.signal?.aborted) {
    const error = new DOMException('AbortError', 'AbortError');
    span.recordError(error);
    await span.end('error');
    throw error;
  }

  if (ctx.router?.health) {
    const waitMs = ctx.router.health.rateLimitWaitMs(ctx.provider.config.name);
    if (waitMs > 0) {
      await abortableSleep(Math.min(waitMs, 5000), ctx.signal);
    }
    ctx.router.health.checkRateLimit(ctx.provider.config.name);
  }

  const provider = ctx.provider as Provider & { sendWithTools?: (prompt: string, tools: ToolDefinition[], opts?: SendOptions) => Promise<string> };

  const onUsage = (usage: UsageInfo): void => {
    recordUsage(ctx, usage);
    span.setAttributes({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
  };

  const baseMessages = truncateMessages(messages);
  const sendWithTools = provider.sendWithTools;

  const TURN_BACKOFFS_MS = [30_000, 60_000, 90_000];
  for (let attempt = 0; ; attempt++) {
    if (Date.now() >= ctx.deadlineMs) {
      const error = new Error('Agent deadline exceeded while waiting for provider');
      span.recordError(error);
      await span.end('error');
      throw error;
    }

    const timeoutMs = boundedProviderRequestTimeoutMs(ctx.deadlineMs);
    try {
      const sendMessages = prompt ? [...baseMessages, { role: 'user' as const, content: prompt }] : baseMessages;
      let raw: string;
      if (typeof sendWithTools === 'function') {
        raw = await abortableOperation(() => sendWithTools.call(provider, prompt ?? 'Execute the next step.', AGENT_TOOLS, {
          system: ctx.systemPrompt,
          model: ctx.model,
          temperature: 0.3,
          timeoutMs,
          onUsage,
          messages: sendMessages,
          onEvent,
        }), ctx.signal);
      } else {
        const transcript = sendMessages
          .map((m) => {
            if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
              const calls = m.tool_calls
                .map((tc) => `  - ${tc.function?.name ?? ''}(${tc.function?.arguments ?? ''})`)
                .join('\n');
              return `[assistant] ${m.content ?? ''}\nTool calls:\n${calls}`;
            }
            if (m.role === 'tool') {
              return `[tool result for ${m.tool_call_id ?? ''}]\n${m.content ?? ''}`;
            }
            return `[${m.role}] ${m.content ?? ''}`;
          })
          .join('\n\n');
        raw = await abortableOperation(() => provider.send(transcript, {
          system: ctx.textToolsSystemPrompt,
          model: ctx.model,
          timeoutMs,
          onUsage,
          onEvent,
        }), ctx.signal);
      }

      span.addEvent('provider.response.received');
      const parsed = parseProviderResponse(raw);
      await span.end('ok');
      return parsed;
    } catch (err) {
      if (Date.now() >= ctx.deadlineMs || ctx.signal?.aborted) {
        span.recordError(err);
        await span.end('error');
        throw err;
      }
      if (attempt < TURN_BACKOFFS_MS.length) {
        const waitMs = Math.min(TURN_BACKOFFS_MS[attempt], Math.max(0, ctx.deadlineMs - Date.now()));
        logger.warn('Provider call failed, retrying turn after backoff', {
          attempt: attempt + 1,
          waitMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await abortableSleep(waitMs, ctx.signal);
        continue;
      }
      span.recordError(err);
      await span.end('error');
      throw err;
    }
  }
}

// --- Response parsing ---

export function parseProviderResponse(raw: string): { content?: string; toolCalls?: string; reasoningContent?: string } {
  const cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const inner = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    return extractToolCalls(inner);
  }
  return extractToolCalls(cleaned);
}

function extractToolCalls(text: string): { content?: string; toolCalls?: string; reasoningContent?: string } {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | unknown[];
    if (!Array.isArray(parsed) && Array.isArray(parsed.tool_calls)) {
      return {
        content: parsed.content as string | undefined,
        toolCalls: JSON.stringify(parsed.tool_calls),
        reasoningContent:
          typeof parsed.reasoning_content === 'string' && parsed.reasoning_content
            ? parsed.reasoning_content
            : undefined,
      };
    }
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).name === 'string')) {
      return { toolCalls: JSON.stringify(parsed) };
    }
    if (!Array.isArray(parsed)) {
      const nestedName = Object.keys(parsed).find((k) => AGENT_TOOL_NAMES.has(k));
      if (nestedName && typeof parsed[nestedName] === 'object' && parsed[nestedName] !== null) {
        return { toolCalls: JSON.stringify([{ id: 'call-0', name: nestedName, arguments: parsed[nestedName] }]) };
      }
      const singleName =
        typeof parsed.name === 'string' && AGENT_TOOL_NAMES.has(parsed.name)
          ? parsed.name
          : typeof parsed.tool === 'string' && AGENT_TOOL_NAMES.has(parsed.tool)
            ? parsed.tool
            : undefined;
      if (singleName) {
        const args =
          typeof parsed.arguments === 'object' && parsed.arguments !== null
            ? parsed.arguments
            : typeof parsed.input === 'object' && parsed.input !== null
              ? parsed.input
              : Object.fromEntries(
                  Object.entries(parsed).filter(([k]) => k !== 'id' && k !== 'tool_call_id' && k !== 'name' && k !== 'tool')
                );
        return { toolCalls: JSON.stringify([{ id: 'call-0', name: singleName, arguments: args }]) };
      }
    }
  } catch {
    // not JSON
  }
  const markdown = parseMarkdownActions(text);
  if (markdown.length > 0) {
    return { content: text, toolCalls: JSON.stringify(markdown) };
  }
  const xml = parseXmlActions(text);
  if (xml.length > 0) {
    return { content: text, toolCalls: JSON.stringify(xml) };
  }
  return { content: text };
}

function parseXmlActions(text: string): ToolCall[] {
  const actions: ToolCall[] = [];
  const invokeRe = /<invoke\s+name="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = invokeRe.exec(text)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const endInvoke = text.indexOf('</invoke>', start);
    if (endInvoke === -1) continue;
    const block = text.slice(start, endInvoke);
    const args: Record<string, string | undefined> = {};
    const paramRe = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(block)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    const id = `xml-${actions.length.toString()}`;
    if (name === 'finish') {
      const summary = args.thought ?? args.summary ?? Object.values(args).filter(Boolean).join(' ');
      actions.push({
        id,
        name,
        arguments: { summary, success: !/fail|error/i.test(summary) },
      });
    } else if (name === 'think') {
      actions.push({ id, name, arguments: { thought: args.thought ?? Object.values(args).filter(Boolean).join(' ') } });
    } else {
      const typedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) typedArgs[k] = v;
      actions.push({ id, name, arguments: typedArgs });
    }
    invokeRe.lastIndex = endInvoke + '</invoke>'.length;
  }
  return actions;
}

function parseMarkdownActions(text: string): ToolCall[] {
  const actions: ToolCall[] = [];
  const actionHeader = /^###\s*Action:\s*(\w+)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = actionHeader.exec(text)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const next = actionHeader.exec(text);
    actionHeader.lastIndex = start;
    const end = next ? next.index : text.length;
    const block = text.slice(start, end).trim();

    if (name === 'finish') {
      actions.push({
        id: `md-${actions.length.toString()}`,
        name,
        arguments: { summary: block, success: !/fail|error/i.test(block) },
      });
      continue;
    }

    if (name === 'think') {
      actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { thought: block } });
      continue;
    }

    if (name === 'run_command') {
      const cmd = extractCodeBlock(block, 'bash') ?? extractCodeBlock(block) ?? block;
      actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { command: cmd.trim() } });
      continue;
    }

    if (name === 'write_file') {
      const code = extractCodeBlock(block);
      if (!code) continue;
      const firstLine = block.split('\n')[0] ?? '';
      const pathRe = /^\s*[`\\/]?([^\n`]+?)[`]?\s*$/;
      pathRe.lastIndex = 0;
      const pathMatch = pathRe.exec(firstLine);
      const path1 = pathMatch?.[1] ?? extractFilePathFromFence(block);
      if (path1) {
        actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { path: path1, content: code } });
      }
      continue;
    }

    if (name === 'read_file') {
      const path2 = block.trim().split('\n')[0]?.trim() ?? '';
      if (path2) {
        actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { path: path2 } });

      }
    }
  }
  return actions;
}

function extractCodeBlock(text: string, lang?: string): string | undefined {
  const pattern = lang
    ? new RegExp(`\\\`\\\`\\\`${lang}\\n([\\s\\S]*?)\\n\\\`\\\`\\\``, 'i')
    : /```(?:[a-z]+)?\n?([\s\S]*?)\n?```/i;
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  return m?.[1];
}

function extractFilePathFromFence(text: string): string | undefined {
  const re = /```(?:[a-z]+)?:?\s*([^\n]+)/i;
  re.lastIndex = 0;
  const m = re.exec(text);
  return m?.[1]?.trim();
}

export function parseToolCalls(raw: string | undefined): ToolCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return parsed
      .map((t, idx) => {
        let name: string | undefined;
        let argsSource: Record<string, unknown> | undefined;
        if (typeof t.name === 'string' && AGENT_TOOL_NAMES.has(t.name)) {
          name = t.name;
        } else if (typeof t.tool === 'string' && AGENT_TOOL_NAMES.has(t.tool)) {
          name = t.tool;
        } else {
          const nested = Object.keys(t).find((k) => AGENT_TOOL_NAMES.has(k));
          if (nested && typeof t[nested] === 'object' && t[nested] !== null) {
            name = nested;
            argsSource = t[nested] as Record<string, unknown>;
          }
        }
        if (!name) return undefined;
        const id =
          (typeof t.id === 'string' && t.id.length > 0 ? t.id : undefined) ??
          (typeof t.tool_call_id === 'string' && t.tool_call_id.length > 0 ? t.tool_call_id : undefined) ??
          `call-${String(idx)}`;
        let args: Record<string, unknown> = {};
        if (argsSource) {
          args = argsSource;
        } else if (typeof t.arguments === 'string') {
          try {
            args = JSON.parse(t.arguments) as Record<string, unknown>;
          } catch {
            args = { raw: t.arguments };
          }
        } else if (typeof t.arguments === 'object' && t.arguments !== null) {
          args = t.arguments as Record<string, unknown>;
        } else if (typeof t.input === 'object' && t.input !== null) {
          args = t.input as Record<string, unknown>;
        } else {
          args = Object.fromEntries(
            Object.entries(t).filter(([k]) => k !== 'id' && k !== 'tool_call_id' && k !== 'name' && k !== 'tool')
          );
        }
        return { id, name, arguments: args };
      })
      .filter((t): t is ToolCall => t !== undefined);
  } catch {
    return [];
  }
}
