import { registerAs } from '@nestjs/config';

export interface TierConfig {
  maxGenerationsPerMonth: number;
  llmModel: string;
  llmProvider: string;
  embeddingProvider: string;
  embeddingModel: string;
}

export const getSubscriptionTiers = (): Record<string, TierConfig> => ({
  FREE: {
    maxGenerationsPerMonth: parseInt(
      process.env.FREE_TIER_MAX_GENERATIONS ||
        process.env.SUBSCRIPTION_FREE_MAX_GENERATIONS ||
        '200',
      10,
    ),
    llmModel:
      process.env.FREE_TIER_LLM_MODEL ||
      process.env.SUBSCRIPTION_FREE_LLM_MODEL ||
      process.env.BEDROCK_LLM_MODEL ||
      'openai.gpt-oss-120b-1:0',
    llmProvider:
      process.env.FREE_TIER_LLM_PROVIDER ||
      process.env.SUBSCRIPTION_FREE_LLM_PROVIDER ||
      'bedrock',
    embeddingProvider:
      process.env.FREE_TIER_EMBEDDING_PROVIDER ||
      process.env.SUBSCRIPTION_FREE_EMBEDDING_PROVIDER ||
      'gemini',
    embeddingModel:
      process.env.FREE_TIER_EMBEDDING_MODEL ||
      process.env.SUBSCRIPTION_FREE_EMBEDDING_MODEL ||
      process.env.GEMINI_EMBEDDING_MODEL ||
      'gemini-embedding-2',
  },
  PRO: {
    maxGenerationsPerMonth: parseInt(
      process.env.PRO_TIER_MAX_GENERATIONS ||
        process.env.SUBSCRIPTION_PRO_MAX_GENERATIONS ||
        '200',
      10,
    ),
    llmModel:
      process.env.PRO_TIER_LLM_MODEL ||
      process.env.SUBSCRIPTION_PRO_LLM_MODEL ||
      process.env.GEMINI_LLM_MODEL ||
      'gemini-3.1-flash-lite',
    llmProvider:
      process.env.PRO_TIER_LLM_PROVIDER ||
      process.env.SUBSCRIPTION_PRO_LLM_PROVIDER ||
      'gemini',
    embeddingProvider:
      process.env.PRO_TIER_EMBEDDING_PROVIDER ||
      process.env.SUBSCRIPTION_PRO_EMBEDDING_PROVIDER ||
      'gemini',
    embeddingModel:
      process.env.PRO_TIER_EMBEDDING_MODEL ||
      process.env.SUBSCRIPTION_PRO_EMBEDDING_MODEL ||
      process.env.GEMINI_EMBEDDING_MODEL ||
      'gemini-embedding-2',
  },
  ULTRA: {
    maxGenerationsPerMonth: parseInt(
      process.env.ULTRA_TIER_MAX_GENERATIONS ||
        process.env.SUBSCRIPTION_ULTRA_MAX_GENERATIONS ||
        '100',
      10,
    ),
    llmModel:
      process.env.ULTRA_TIER_LLM_MODEL ||
      process.env.SUBSCRIPTION_ULTRA_LLM_MODEL ||
      process.env.GEMINI_LLM_MODEL ||
      'gemini-3.1-flash-lite',
    llmProvider:
      process.env.ULTRA_TIER_LLM_PROVIDER ||
      process.env.SUBSCRIPTION_ULTRA_LLM_PROVIDER ||
      'gemini',
    embeddingProvider:
      process.env.ULTRA_TIER_EMBEDDING_PROVIDER ||
      process.env.SUBSCRIPTION_ULTRA_EMBEDDING_PROVIDER ||
      'gemini',
    embeddingModel:
      process.env.ULTRA_TIER_EMBEDDING_MODEL ||
      process.env.SUBSCRIPTION_ULTRA_EMBEDDING_MODEL ||
      process.env.GEMINI_EMBEDDING_MODEL ||
      'gemini-embedding-2',
  },
});

export const DEFAULT_SUBSCRIPTION_TIERS: Record<string, TierConfig> =
  getSubscriptionTiers();

export default registerAs('subscription', () => ({
  tiers: getSubscriptionTiers(),
}));