import { LlmModelTier } from './llm-provider.interface';

/**
 * Common fields attached to every result produced by AiProviderService so
 * callers can observe which provider served the request.
 */
export interface AiProviderBaseResult {
  provider: string;
  latencyMs: number;
  fallbackOccurred: boolean;
}

export interface AiLlmResult extends AiProviderBaseResult {
  text: string;
  model: string;
  tier: LlmModelTier;
}

export interface AiEmbeddingBatchResult extends AiProviderBaseResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

export interface AiEmbeddingResult extends AiProviderBaseResult {
  embedding: number[];
  model: string;
  dimensions: number;
}
