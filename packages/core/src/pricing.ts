import type { UsageInfo } from './provider.js';

/**
 * Token pricing, in USD per million tokens.
 *
 * The repo previously had no pricing table at all, so `AgentRun.costUsd` was
 * only ever populated on the external-CLI path (where the CLI reports its own
 * cost) and every in-house run recorded `null`. Anything that summed cost was
 * therefore under-reporting rather than wrong-by-a-little.
 *
 * These are list prices and WILL drift. Treat any figure derived from them as
 * an estimate: `estimateCostUsd` returns null for an unknown model rather than
 * guessing, so callers can tell "we don't know" apart from "it was free".
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** Context window in tokens, used for occupancy percentages. */
  contextWindow: number;
}

/** Matched case-insensitively, longest key first, as a substring of the model id. */
const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  'claude-opus-4': { input: 15, output: 75, contextWindow: 200_000 },
  'claude-sonnet-4': { input: 3, output: 15, contextWindow: 200_000 },
  'claude-haiku-4': { input: 0.8, output: 4, contextWindow: 200_000 },
  'claude-3-5-haiku': { input: 0.8, output: 4, contextWindow: 200_000 },
  'claude-3-5-sonnet': { input: 3, output: 15, contextWindow: 200_000 },
  // OpenAI
  'gpt-5-mini': { input: 0.25, output: 2, contextWindow: 400_000 },
  'gpt-5-nano': { input: 0.05, output: 0.4, contextWindow: 400_000 },
  'gpt-5': { input: 1.25, output: 10, contextWindow: 400_000 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, contextWindow: 128_000 },
  'gpt-4o': { input: 2.5, output: 10, contextWindow: 128_000 },
  'o4-mini': { input: 1.1, output: 4.4, contextWindow: 200_000 },
  // Google
  'gemini-2.5-flash': { input: 0.3, output: 2.5, contextWindow: 1_000_000 },
  'gemini-2.5-pro': { input: 1.25, output: 10, contextWindow: 1_000_000 },
  // Zhipu / GLM
  'glm-5': { input: 0.6, output: 2.2, contextWindow: 200_000 },
  'glm-4.6': { input: 0.6, output: 2.2, contextWindow: 200_000 },
  // Moonshot / Kimi
  k3: { input: 0.6, output: 2.5, contextWindow: 256_000 },
  'kimi-for-coding': { input: 0.6, output: 2.5, contextWindow: 256_000 },
  // DeepSeek
  'deepseek-chat': { input: 0.27, output: 1.1, contextWindow: 128_000 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, contextWindow: 128_000 },
  // MiniMax
  minimax: { input: 0.3, output: 1.2, contextWindow: 200_000 },
  // Qwen
  qwen: { input: 0.4, output: 1.2, contextWindow: 128_000 },
  // Local models cost nothing to run.
  llama: { input: 0, output: 0, contextWindow: 128_000 },
  qwen3: { input: 0, output: 0, contextWindow: 128_000 },
  mistral: { input: 0, output: 0, contextWindow: 32_000 },
};

const KEYS_BY_SPECIFICITY = Object.keys(PRICES).sort((a, b) => b.length - a.length);

/** The price entry for a model id, or null when we have no figure for it. */
export function lookupModelPrice(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const needle = model.toLowerCase();
  for (const key of KEYS_BY_SPECIFICITY) {
    if (needle.includes(key)) return PRICES[key];
  }
  return null;
}

/**
 * Cost of one exchange in USD, or null when the model is unpriced.
 *
 * Null is meaningful — do not coerce it to 0 at the call site, or unpriced
 * models silently look free and budget caps stop protecting anything.
 */
export function estimateCostUsd(model: string | null | undefined, usage: UsageInfo): number | null {
  const price = lookupModelPrice(model);
  if (!price) return null;
  const input = Math.max(0, usage.promptTokens ?? 0);
  const output = Math.max(0, usage.completionTokens ?? 0);
  return (input * price.input + output * price.output) / 1_000_000;
}

/** Context window for a model, falling back to a conservative default. */
export function contextWindowFor(model: string | null | undefined, fallback = 200_000): number {
  return lookupModelPrice(model)?.contextWindow ?? fallback;
}
