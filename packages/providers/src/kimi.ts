import type { Provider, ProviderConfig } from '@omega/core';
import { OpenAIProvider } from './openai.js';

export class KimiProvider extends OpenAIProvider implements Provider {
  constructor(public readonly config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.moonshot.ai/v1',
    });
  }
}
