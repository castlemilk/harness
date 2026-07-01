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

export type ProviderKind = 'openai' | 'anthropic' | 'ollama' | 'gemini' | 'generic';

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

export interface SendOptions {
  model?: string;
  system?: string;
  temperature?: number;
}

export interface Provider {
  readonly config: ProviderConfig;
  listModels(): Promise<string[]>;
  send(prompt: string, opts?: SendOptions): Promise<string>;
}
