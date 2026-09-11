export interface ModelRef {
  provider: string;
  model: string;
}

export type CapabilityLevel = 'fast' | 'capable' | 'advanced';

export type ReasoningEffort = 'low' | 'high' | 'max';

export interface Capability {
  name: string;
  level: CapabilityLevel;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  /** Enable the provider's thinking/reasoning mode (e.g. DeepSeek thinking). */
  thinking?: boolean;
  /** Reasoning effort when thinking mode is enabled. */
  reasoningEffort?: ReasoningEffort;
}

export type ProviderKind = 'openai' | 'anthropic' | 'ollama' | 'gemini' | 'kimi' | 'generic';

export interface CredentialsUpdate {
  apiKey: string;
  refreshToken: string;
  tokenExpiresAt: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  refreshToken?: string;
  tokenExpiresAt?: number; // epoch ms
  defaultModel: string;
  capabilities: Capability[];
  enabled: boolean;
  onCredentialsUpdate?: (creds: CredentialsUpdate) => void;
  /** Default cache mode for local inference (Ollama). */
  defaultCacheMode?: 'cold' | 'warm-prefix' | 'warm-ngram';
  /** Default warmup runs before measured requests. */
  defaultWarmupRuns?: number;
  /** Default context tokens for local models. */
  defaultContextTokens?: number;
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Duration of prompt prefill in seconds (when reported by the backend). */
  promptDurationS?: number;
  /** Duration of token generation in seconds (when reported by the backend). */
  generationDurationS?: number;
  /** Ratio of prefill work avoided by n-gram/prefix cache reuse (0-1). */
  ngramCacheHitRate?: number;
}

export type ProviderEvent =
  | { type: 'request'; model: string; attempt: number }
  | { type: 'retry'; model: string; retryAttempt: number; status?: number; waitMs: number; error?: string }
  | { type: 'rotation'; model: string; nextModel: string; rotation: number }
  | { type: 'response'; model: string; status: number }
  | { type: 'error'; model: string; status?: number };

export interface ProviderTelemetry {
  calls: number;
  retries: number;
  rateLimitRetries: number;
  rotations: number;
  modelsTried: string[];
  effectiveModel?: string;
  lastStatus?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  reasoning_content?: string;
  tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface SendOptions {
  model?: string;
  system?: string;
  temperature?: number;
  /** Enable provider-native reasoning/thinking mode when supported. */
  thinking?: boolean;
  onUsage?: (usage: UsageInfo) => void;
  messages?: ChatMessage[];
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: (event: ProviderEvent) => void;
  /**
   * Cache mode for local inference backends that support prefix/KV-cache
   * reuse. "cold" sends a distinct warmup; "warm-prefix" sends the same
   * prompt; "warm-ngram" appends a small n-gram marker to build KV-cache
   * state for the full prefix before measuring.
   */
  cacheMode?: 'cold' | 'warm-prefix' | 'warm-ngram';
  /** Number of warmup runs before the measured request. */
  warmupRuns?: number;
  /** Maximum context tokens to request (maps to num_ctx in Ollama). */
  contextTokens?: number;
  /** Ollama keep-alive duration (e.g. "30m", "5m", 0). */
  keepAlive?: string | number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSendOptions extends SendOptions {
  tools: ToolDefinition[];
}

export interface Provider {
  readonly config: ProviderConfig;
  listModels(): Promise<string[]>;
  send(prompt: string, opts?: SendOptions): Promise<string>;
  sendWithTools?(prompt: string, tools: ToolDefinition[], opts?: SendOptions): Promise<string>;
}
