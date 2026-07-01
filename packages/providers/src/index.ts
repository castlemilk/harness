export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { OllamaProvider } from './ollama.js';
export { GeminiProvider } from './gemini.js';
export { GenericProvider } from './generic.js';

import type { Provider, ProviderConfig } from '@omega/core';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';
import { GenericProvider } from './generic.js';

export function createProvider(config: ProviderConfig): Provider {
  switch (config.kind) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'generic':
      return new GenericProvider(config);
    default:
      throw new Error(`Unknown provider kind: ${(config as ProviderConfig).kind}`);
  }
}
