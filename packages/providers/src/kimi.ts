import type { Provider, ProviderConfig, SendOptions, ToolDefinition } from '@omega/core';
import { OpenAIProvider } from './openai.js';

export class KimiProvider extends OpenAIProvider implements Provider {
  constructor(public readonly config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? 'https://api.kimi.com/coding/v1',
    });
  }

  protected override readonly supportsTemperature: boolean = true;

  // Kimi coding models require temperature to be exactly 1.
  override async send(prompt: string, opts?: SendOptions): Promise<string> {
    return super.send(prompt, { ...opts, temperature: 1 });
  }

  override async sendWithTools(
    prompt: string,
    tools: ToolDefinition[],
    opts?: SendOptions
  ): Promise<string> {
    return super.sendWithTools(prompt, tools, { ...opts, temperature: 1 });
  }
}
