import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module';
import { AiProviderService } from './ai-provider.service';
import { BedrockGatewayLlmProvider } from './bedrock-llm.provider';
import { BedrockGatewayEmbeddingProvider } from './bedrock-embedding.provider';
import { GeminiLlmProvider } from './gemini-llm.provider';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';

@Module({
  imports: [GeminiModule],
  providers: [
    BedrockGatewayLlmProvider,
    BedrockGatewayEmbeddingProvider,
    OpenRouterEmbeddingProvider,
    GeminiLlmProvider,
    GeminiEmbeddingProvider,
    AiProviderService,
  ],
  exports: [AiProviderService],
})
export class AiProviderModule {}
