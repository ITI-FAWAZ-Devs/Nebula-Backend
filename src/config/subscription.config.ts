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
    llmModel: 'gemini-3.1-flash-lite',
    llmProvider: 'gemini',
    embeddingProvider: 'gemini',
    embeddingModel: 'gemini-embedding-2',
  },
  PRO: {
    maxGenerationsPerMonth: 200,
    llmModel: 'gemini-3.1-flash-lite',
    llmProvider: 'gemini',
    embeddingProvider: 'gemini',
    embeddingModel: 'gemini-embedding-2',
  },
  ULTRA: {
    maxGenerationsPerMonth: 100,
    llmModel: 'gemini-3.1-flash-lite',
    llmProvider: 'gemini',
    embeddingProvider: 'gemini',
    embeddingModel: 'gemini-embedding-2',
  },
};

export default registerAs('subscription', () => ({
  tiers: DEFAULT_SUBSCRIPTION_TIERS,
}));
