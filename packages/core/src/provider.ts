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
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
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
  onUsage?: (usage: UsageInfo) => void;
  messages?: ChatMessage[];
  timeoutMs?: number;
  maxRetries?: number;
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
