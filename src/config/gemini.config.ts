import { registerAs } from '@nestjs/config';

export default registerAs('gemini', () => ({
  apiKey: process.env.GEMINI_API_KEY || process.env.GEMININ_API_KEY || '',
  llmModel: process.env.GEMINI_LLM_MODEL || 'gemini-3.6-flash',
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
  embeddingDimensions: parseInt(
    process.env.GEMINI_EMBEDDING_DIMENSIONS || '768',
    10,
  ),
}));
