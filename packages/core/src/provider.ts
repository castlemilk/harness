export interface ModelRef {
  provider: string;
  model: string;
}

export type CapabilityLevel = 'fast' | 'capable' | 'advanced';

export interface Capability {
  name: string;
  level: CapabilityLevel;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export type ProviderKind = 'openai' | 'anthropic' | 'ollama' | 'gemini' | 'kimi' | 'generic';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  defaultModel: string;
  capabilities: Capability[];
  enabled: boolean;
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface SendOptions {
  model?: string;
  system?: string;
  temperature?: number;
  onUsage?: (usage: UsageInfo) => void;
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
