import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_OPENROUTER_EMBEDDING_MODEL } from '../config/ai-provider.config';
import { EmbeddingProvider } from './interfaces/embedding-provider.interface';
import { withAbortSignal } from './fetch-timeout.util';

/**
 * OpenRouter embedding provider — Tier 2 of the embedding chain.
 *
 *   POST https://openrouter.ai/api/v1/embeddings
 *   Authorization: Bearer {OPENROUTER_API_KEY}
 *   {
 *     "model": "nvidia/llama-nemotron-embed-vl-1b-v2:free",
 *     "input": ["...", "..."]
 *   }
 *
 *   Response: { "data": [ { "embedding": [...], "index": 0 }, ... ], "model": ... }
 *
 * Unlike the Bedrock gateway, `input` accepts a full batch in a single call —
 * the free tier is limited by request count, not tokens, so all texts are sent
 * together. `input_type` is a Bedrock-gateway concept and is NOT sent here.
 *
 * The embedding dimension is not documented by OpenRouter, so it is derived
 * from the first successful response unless OPENROUTER_EMBEDDING_DIMENSIONS is
 * set. The provider is excluded from the chain until OPENROUTER_API_KEY is
 * configured (see AiProviderService).
 */
@Injectable()
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openrouter';
  private readonly logger = new Logger(OpenRouterEmbeddingProvider.name);
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly defaultDimensions: number;
  private readonly embeddingTimeoutMs: number;
  private resolvedDimensions = 0;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('aiProvider.openrouterApiKey') || '';
    this.modelId =
      this.configService.get<string>('aiProvider.openrouterEmbeddingModel') ||
      DEFAULT_OPENROUTER_EMBEDDING_MODEL;
    this.defaultDimensions =
      this.configService.get<number>(
        'aiProvider.openrouterEmbeddingDimensions',
      ) || 0;
    this.embeddingTimeoutMs =
      this.configService.get<number>('aiProvider.embeddingTimeoutMs') ?? 60000;

    if (!this.apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY is not configured; OpenRouter embeddings are excluded from the chain',
      );
    }
  }

  get model(): string {
    return this.modelId;
  }

  get dimensions(): number {
    return this.resolvedDimensions || this.defaultDimensions || 0;
  }

  async embedString(text: string): Promise<number[]> {
    const [embedding] = await this.embedMany([text]);
    return embedding;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error(
        'OpenRouter is not configured (OPENROUTER_API_KEY missing)',
      );
    }

    const response = await withAbortSignal(this.embeddingTimeoutMs, (signal) =>
      fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.modelId, input: texts }),
        signal,
      }),
    );

    if (!response.ok) {
      const status = response.status;
      const body = await response.text().catch(() => '');
      const error = new Error(
        `OpenRouter embedding request failed with status ${status}: ${body}`,
      ) as Error & { status?: number };
      error.status = status;
      throw error;
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    if (!Array.isArray(payload?.data) || payload.data.length !== texts.length) {
      throw new Error(
        `Invalid embedding response from OpenRouter: expected ${texts.length} embeddings, got ${payload?.data?.length ?? 'none'}`,
      );
    }

    const sorted = [...payload.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const embeddings = sorted.map((entry) => entry.embedding);
    for (const vector of embeddings) {
      if (!Array.isArray(vector) || vector.some((v) => typeof v !== 'number')) {
        throw new Error('Invalid embedding vector from OpenRouter');
      }
    }

    if (embeddings.length > 0) {
      this.resolvedDimensions = (embeddings[0] as number[]).length;
    }
    return embeddings as number[][];
  }
}
