import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildFileDescriptionPrompt,
  buildAnswerQuestionPrompt,
} from '../gemini/prompts';
import { BedrockGatewayLlmProvider } from './bedrock-llm.provider';
import { BedrockGatewayEmbeddingProvider } from './bedrock-embedding.provider';
import { GeminiLlmProvider } from './gemini-llm.provider';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';
import {
  LlmProvider,
  LlmProviderOptions,
} from './interfaces/llm-provider.interface';
import {
  EmbeddingInputType,
  EmbeddingProvider,
} from './interfaces/embedding-provider.interface';
import {
  AiProviderBaseResult,
  AiLlmResult,
  AiEmbeddingResult,
  AiEmbeddingBatchResult,
} from './interfaces/ai-provider-result.interface';
import { isTransientFailure } from './fallback-classifier.util';

/**
 * Single entry point for every LLM and embedding call in the app.
 *
 * LLM and embedding chains are configured independently:
 * `LLM_PROVIDER_ORDER` (default `bedrock,gemini`) and
 * `EMBEDDING_PROVIDER_ORDER` (default `bedrock,openrouter,gemini`). The legacy
 * `AI_PROVIDER_ORDER` is honored when the per-capability vars are absent.
 *
 * Each chain tries the primary provider first and falls back to the next
 * provider ONLY on qualifying transient failures. Non-transient failures
 * (validation, content-policy, auth/config) fail loudly. Providers that are
 * listed but not configured (e.g. OpenRouter without a key) are skipped with a
 * warning so a not-yet-enabled tier never breaks the chain.
 *
 * Every result is tagged with which provider served it and whether a
 * fallback occurred.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly llmOrder: string[];
  private readonly embeddingOrder: string[];
  private readonly llmProviders: LlmProvider[];
  private readonly embeddingProviders: EmbeddingProvider[];

  constructor(
    private readonly configService: ConfigService,
    private readonly bedrockLlm: BedrockGatewayLlmProvider,
    private readonly bedrockEmbedding: BedrockGatewayEmbeddingProvider,
    private readonly openrouterEmbedding: OpenRouterEmbeddingProvider,
    private readonly geminiLlm: GeminiLlmProvider,
    private readonly geminiEmbedding: GeminiEmbeddingProvider,
  ) {
    const legacyOrder =
      this.configService.get<string>('aiProvider.providerOrder') || '';
    const parseOrder = (value: string, fallback: string): string[] =>
      (value || fallback)
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0);

    this.llmOrder = parseOrder(
      this.configService.get<string>('aiProvider.llmProviderOrder') ||
        legacyOrder,
      'bedrock,gemini',
    );
    this.embeddingOrder = parseOrder(
      this.configService.get<string>('aiProvider.embeddingProviderOrder') ||
        legacyOrder,
      'bedrock,openrouter,gemini',
    );

    const llmRegistry: Record<string, LlmProvider> = {
      bedrock: this.bedrockLlm,
      gemini: this.geminiLlm,
    };
    const embeddingRegistry: Record<string, EmbeddingProvider> = {
      bedrock: this.bedrockEmbedding,
      openrouter: this.openrouterEmbedding,
      gemini: this.geminiEmbedding,
    };

    this.llmProviders = this.llmOrder
      .filter((name) => llmRegistry[name])
      .map((name) => llmRegistry[name]);
    this.embeddingProviders = this.embeddingOrder
      .filter((name) => embeddingRegistry[name])
      .filter((name) => this.isEmbeddingProviderActive(name))
      .map((name) => embeddingRegistry[name]);

    if (this.llmProviders.length === 0) {
      this.logger.warn(
        `LLM_PROVIDER_ORDER="${this.llmOrder.join(',')}" resolved to no known LLM providers`,
      );
    }
    if (this.embeddingProviders.length === 0) {
      this.logger.warn(
        `EMBEDDING_PROVIDER_ORDER="${this.embeddingOrder.join(',')}" resolved to no known embedding providers`,
      );
    }
  }

  /**
   * A listed embedding provider that is not configured is skipped rather than
   * hard-failing, so the chain degrades gracefully until it is enabled.
   */
  private isEmbeddingProviderActive(name: string): boolean {
    if (name === 'openrouter') {
      const configured = !!this.configService.get<string>(
        'aiProvider.openrouterApiKey',
      );
      if (!configured) {
        this.logger.warn(
          'OPENROUTER_API_KEY is not configured; OpenRouter is excluded from the embedding chain',
        );
      }
      return configured;
    }
    return true;
  }

  get configuredOrder(): string[] {
    return [...this.llmOrder];
  }

  /**
   * Generic LLM completion through the provider chain.
   */
  async generateContent(
    prompt: string,
    options?: LlmProviderOptions,
  ): Promise<AiLlmResult> {
    const tier = options?.tier ?? 'standard';
    const resolvedOptions: LlmProviderOptions = { tier };
    return this.executeChain(
      this.llmProviders,
      async (provider, index) => {
        const started = Date.now();
        const providerResult = await provider.generateContent(
          prompt,
          resolvedOptions,
        );
        return {
          text: providerResult.text,
          model: providerResult.model,
          tier,
          provider: provider.name,
          latencyMs: Date.now() - started,
          fallbackOccurred: index > 0,
        };
      },
      'LLM',
    );
  }

  /**
   * File-level description (high volume; standard tier).
   */
  async describeFile(
    filePath: string,
    content: string,
    options?: LlmProviderOptions,
  ): Promise<AiLlmResult> {
    const prompt = buildFileDescriptionPrompt(filePath, content);
    return this.generateContent(prompt, options);
  }

  /**
   * RAG question answering grounded in retrieved documentation context.
   */
  async answerQuestion(
    question: string,
    context: string,
    options?: LlmProviderOptions,
  ): Promise<AiLlmResult> {
    const prompt = buildAnswerQuestionPrompt(question, context);
    return this.generateContent(prompt, options);
  }

  /**
   * Embeds a batch of strings through the provider chain. A batch is always
   * served entirely by a single provider so its vectors share one space.
   *
   * `inputType` is forwarded to the provider: `search_document` for indexing
   * chunks into the vector store, `search_query` when embedding a
   * retrieval-time query.
   */
  async embedMany(
    texts: string[],
    inputType: EmbeddingInputType = 'search_document',
  ): Promise<AiEmbeddingBatchResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        model: '',
        dimensions: 0,
        provider: '',
        latencyMs: 0,
        fallbackOccurred: false,
      };
    }

    return this.executeChain(
      this.embeddingProviders,
      async (provider, index) => {
        const started = Date.now();
        const embeddings = await provider.embedMany(texts, inputType);
        return {
          embeddings,
          model: provider.model,
          dimensions: provider.dimensions,
          provider: provider.name,
          latencyMs: Date.now() - started,
          fallbackOccurred: index > 0,
        };
      },
      'EMBEDDING',
    );
  }

  /**
   * Embeds a single string through the provider chain.
   */
  async embedString(
    text: string,
    inputType: EmbeddingInputType = 'search_query',
  ): Promise<AiEmbeddingResult> {
    const batch = await this.embedMany([text], inputType);
    return {
      embedding: batch.embeddings[0],
      model: batch.model,
      dimensions: batch.dimensions,
      provider: batch.provider,
      latencyMs: batch.latencyMs,
      fallbackOccurred: batch.fallbackOccurred,
    };
  }

  private async executeChain<
    T extends AiProviderBaseResult,
    P extends { name: string } = { name: string },
  >(
    providers: P[],
    attempt: (provider: P, index: number) => Promise<T>,
    kind: 'LLM' | 'EMBEDDING',
  ): Promise<T> {
    if (providers.length === 0) {
      const orderVar =
        kind === 'LLM'
          ? `LLM_PROVIDER_ORDER="${this.llmOrder.join(',')}"`
          : `EMBEDDING_PROVIDER_ORDER="${this.embeddingOrder.join(',')}"`;
      throw new Error(`No ${kind} providers are configured (${orderVar})`);
    }

    let lastError: unknown;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        const result = await attempt(provider, i);
        this.logger.log(
          `[${kind}] Served by provider="${result.provider}" fallbackOccurred=${result.fallbackOccurred} latencyMs=${result.latencyMs}`,
        );
        return result;
      } catch (error) {
        lastError = error;
        const transient = isTransientFailure(error);
        const isLast = i === providers.length - 1;

        if (!transient) {
          this.logger.error(
            `[${kind}] Provider "${provider.name}" failed with non-transient error; not falling back: ${(error as Error).message}`,
          );
          throw error;
        }

        if (isLast) {
          this.logger.error(
            `[${kind}] Provider "${provider.name}" failed after exhausting all providers: ${(error as Error).message}`,
          );
          throw error;
        }

        this.logger.warn(
          `[${kind}] Provider "${provider.name}" failed with transient error; falling back to "${providers[i + 1].name}": ${(error as Error).message}`,
        );
      }
    }

    throw lastError;
  }
}
