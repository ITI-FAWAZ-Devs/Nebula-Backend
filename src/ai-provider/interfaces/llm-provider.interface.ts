export type LlmModelTier = 'standard' | 'strong';

export interface LlmProviderOptions {
  tier?: LlmModelTier;
}

export interface LlmProviderResult {
  text: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  generateContent(
    prompt: string,
    options?: LlmProviderOptions,
  ): Promise<LlmProviderResult>;
}
