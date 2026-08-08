import { registerAs } from '@nestjs/config';

export interface TierConfig {
  maxGenerationsPerMonth: number;
  llmModel: string;
  llmProvider: string;
  embeddingProvider: string;
  embeddingModel: string;
}

export const DEFAULT_SUBSCRIPTION_TIERS: Record<string, TierConfig> = {
  FREE: {
    maxGenerationsPerMonth: 200,
    llmModel: 'gemini-3.6-flash',
    llmProvider: 'gemini',
    embeddingProvider: 'gemini',
    embeddingModel: 'text-embedding-004',
  },
  PRO: {
    maxGenerationsPerMonth: 200,
    llmModel: 'gemini-3.6-flash',
    llmProvider: 'gemini',
    embeddingProvider: 'gemini',
    embeddingModel: 'text-embedding-004',
  },
  ULTRA: {
    maxGenerationsPerMonth: 100,
    llmModel: 'gemini-3.6-flash',
    llmProvider: 'gemini',
    embeddingProvider: 'gemini',
    embeddingModel: 'text-embedding-004',
  },
};

export default registerAs('subscription', () => ({
  tiers: DEFAULT_SUBSCRIPTION_TIERS,
}));
