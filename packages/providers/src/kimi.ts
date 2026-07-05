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
    _tools: ToolDefinition[],
    opts?: SendOptions
  ): Promise<string> {
    // Kimi-for-coding follows the text-instructions format more reliably than
    // native function calling, so we route tool-aware prompts through the plain
    // chat completion path. The system prompt already contains tool descriptions.
    return super.send(prompt, { ...opts, temperature: 1 });
  }
}
