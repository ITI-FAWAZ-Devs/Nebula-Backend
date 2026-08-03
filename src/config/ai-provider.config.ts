import { registerAs } from '@nestjs/config';

const VALID_TITAN_DIMENSIONS = [256, 512, 1024];

export const DEFAULT_BEDROCK_EMBEDDING_MODELS = [
  'us.cohere.embed-v4:0',
  'amazon.titan-embed-text-v2:0:8k',
  'amazon.nova-2-multimodal-embeddings-v1:0',
  'amazon.titan-embed-image-v1',
  'us.twelvelabs.marengo-embed-3-0-v1:0',
];

export const DEFAULT_OPENROUTER_EMBEDDING_MODEL =
  'nvidia/llama-nemotron-embed-vl-1b-v2:free';

const parseModelList = (
  value: string | undefined,
  fallback: string,
): string[] =>
  (value || fallback)
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

export default registerAs('aiProvider', () => {
  const rawDimensions = parseInt(
    process.env.BEDROCK_EMBEDDING_DIMENSIONS || '1024',
    10,
  );
  const bedrockEmbeddingDimensions = VALID_TITAN_DIMENSIONS.includes(
    rawDimensions,
  )
    ? rawDimensions
    : 1024;

  return {
    providerOrder: process.env.AI_PROVIDER_ORDER || 'bedrock,gemini',
    llmProviderOrder:
      process.env.LLM_PROVIDER_ORDER ||
      process.env.AI_PROVIDER_ORDER ||
      'bedrock,gemini',
    embeddingProviderOrder:
      process.env.EMBEDDING_PROVIDER_ORDER ||
      process.env.AI_PROVIDER_ORDER ||
      'bedrock,openrouter,gemini',
    sbgApiKey: process.env.SBG_API_KEY || '',
    bedrockGatewayBaseUrl: process.env.BEDROCK_GATEWAY_BASE_URL || '',
    bedrockLlmModels: parseModelList(
      process.env.BEDROCK_LLM_MODEL,
      'openai.gpt-oss-120b-1:0',
    ),
    bedrockLlmModel: parseModelList(
      process.env.BEDROCK_LLM_MODEL,
      'openai.gpt-oss-120b-1:0',
    )[0],
    bedrockLlmModelStrong:
      process.env.BEDROCK_LLM_MODEL_STRONG || 'openai.gpt-oss-120b-1:0',
    bedrockMaxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS || '16384', 10),
    llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
    embeddingTimeoutMs: parseInt(
      process.env.EMBEDDING_TIMEOUT_MS || '60000',
      10,
    ),
    bedrockEmbeddingModels: (
      process.env.BEDROCK_EMBEDDING_MODELS ||
      DEFAULT_BEDROCK_EMBEDDING_MODELS.join(',')
    )
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model.length > 0),
    bedrockEmbeddingDimensions,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openrouterEmbeddingModel:
      process.env.OPENROUTER_EMBEDDING_MODEL ||
      DEFAULT_OPENROUTER_EMBEDDING_MODEL,
    openrouterEmbeddingDimensions: parseInt(
      process.env.OPENROUTER_EMBEDDING_DIMENSIONS || '0',
      10,
    ),
  };
});
