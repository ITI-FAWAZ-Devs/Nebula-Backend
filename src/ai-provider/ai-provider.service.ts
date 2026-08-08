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
 * `LLM_PROVIDER_ORDER` (default `gemini,bedrock`) and
 * `EMBEDDING_PROVIDER_ORDER` (default `gemini,bedrock,openrouter`). The legacy
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
      'gemini,bedrock',
    );
    this.embeddingOrder = parseOrder(
      this.configService.get<string>('aiProvider.embeddingProviderOrder') ||
        legacyOrder,
      'gemini,bedrock,openrouter',
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
    options?: LlmProviderOptions & { overrideProvider?: string },
  ): Promise<AiLlmResult> {
    const tier = options?.tier ?? 'standard';
    const resolvedOptions: LlmProviderOptions = {
      tier,
      overrideModel: options?.overrideModel,
    };

    let providersToUse = this.llmProviders;
    if (options?.overrideProvider) {
      const targetName = options.overrideProvider.toLowerCase();
      providersToUse = this.llmProviders.filter((p) => p.name === targetName);
      if (providersToUse.length === 0) {
        // Fallback to all providers if target not found
        providersToUse = this.llmProviders;
      }
    }

    return this.executeChain(
      providersToUse,
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
    options?: LlmProviderOptions & { overrideProvider?: string },
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
    options?: LlmProviderOptions & { overrideProvider?: string },
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
    options?: { overrideProvider?: string; overrideModel?: string },
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

    let providersToUse = this.embeddingProviders;
    if (options?.overrideProvider) {
      const targetName = options.overrideProvider.toLowerCase();
      const matched = this.embeddingProviders.filter((p) => p.name === targetName);
      if (matched.length > 0) {
        providersToUse = matched;
      }
    }

    return this.executeChain(
      providersToUse,
      async (provider, index) => {
        const started = Date.now();
        const embeddings = await provider.embedMany(texts, inputType, {
          overrideModel: options?.overrideModel,
        });
        const modelName = options?.overrideModel || provider.model;
        const dims = embeddings[0]?.length || provider.dimensions;
        return {
          embeddings,
          model: modelName,
          dimensions: dims,
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
    options?: { overrideProvider?: string; overrideModel?: string },
  ): Promise<AiEmbeddingResult> {
    const batch = await this.embedMany([text], inputType, options);
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

    const provider = providers[0];
    try {
      const result = await attempt(provider, 0);
      this.logger.log(
        `[${kind}] Served by provider="${result.provider}" fallbackOccurred=false latencyMs=${result.latencyMs}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[${kind}] Provider "${provider.name}" failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
