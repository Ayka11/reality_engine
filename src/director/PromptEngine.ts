import { OllamaProvider } from './llm/OllamaProvider';

export class PromptEngine {
  private providerImpl: any;

  constructor(provider?: any) {
    // allow configuration object: { kind: 'ollama', opts: { baseUrl, model } }
    if (provider?.kind === 'ollama') {
      this.providerImpl = new OllamaProvider(provider.opts || {});
    } else {
      this.providerImpl = provider;
    }
  }

  async generate(prompt: string, opts?: any) {
    if (this.providerImpl?.generate) return this.providerImpl.generate(prompt, opts);
    return { text: 'LLM response placeholder', prompt };
  }
}

