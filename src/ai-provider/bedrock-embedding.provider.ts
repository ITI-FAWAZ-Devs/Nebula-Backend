import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_BEDROCK_EMBEDDING_MODELS } from '../config/ai-provider.config';
import {
  EmbeddingInputType,
  EmbeddingProvider,
} from './interfaces/embedding-provider.interface';

/**
 * Bedrock embedding provider backed by the internal SBG gateway.
 *
 * The gateway exposes a normalized embedding endpoint:
 *
 *   POST {base_url}/student/embed
 *   Authorization: Bearer {SBG_API_KEY}
 *   {
 *     "model_id": "us.cohere.embed-v4:0",
 *     "texts": ["..."],
 *     "input_type": "search_document" | "search_query"
 *   }
 *
 * The student key is provisioned for only SOME of the gateway's models, so
 * `BEDROCK_EMBEDDING_MODELS` is an ordered candidate list. The first model
 * that answers a probe is PINNED for the process lifetime (`model`/
 * `dimensions` reflect the resolved model). Re-probing happens only if every
 * candidate failed, and never mid-run — mixing vectors from two models in one
 * collection corrupts similarity search. If the resolved model differs from
 * the configured primary, a loud warning is logged because previously-indexed
 * vectors may live in a different model's space.
 *
 * `input_type` must be `"search_document"` when indexing and
 * `"search_query"` when embedding a retrieval query. The gateway accepts ONE
 * text per request for Amazon models (rejects batches with HTTP 400), so
 * batches are split into one request per text.
 */
@Injectable()
export class BedrockGatewayEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'bedrock';
  private readonly logger = new Logger(BedrockGatewayEmbeddingProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly candidateModels: string[];
  private readonly defaultDimensions: number;
  private resolutionPromise: Promise<string> | null = null;
  private resolvedModel: string | null = null;
  private resolvedDimensions = 0;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('aiProvider.sbgApiKey') || '';
    this.baseUrl =
      this.configService.get<string>('aiProvider.bedrockGatewayBaseUrl') || '';
    this.candidateModels =
      this.configService.get<string[]>('aiProvider.bedrockEmbeddingModels') ??
      DEFAULT_BEDROCK_EMBEDDING_MODELS;
    this.defaultDimensions =
      this.configService.get<number>('aiProvider.bedrockEmbeddingDimensions') ||
      1024;

    if (!this.apiKey) {
      this.logger.warn('SBG_API_KEY is not configured');
    }
    if (!this.baseUrl) {
      this.logger.warn(
        'BEDROCK_GATEWAY_BASE_URL is not configured; Bedrock embeddings will fail',
      );
    }
  }

  get model(): string {
    return this.resolvedModel ?? this.candidateModels[0] ?? '';
  }

  get dimensions(): number {
    return this.resolvedDimensions || this.defaultDimensions;
  }

  async embedString(
    text: string,
    inputType?: EmbeddingInputType,
  ): Promise<number[]> {
    const [embedding] = await this.embedMany([text], inputType);
    return embedding;
  }

  async embedMany(
    texts: string[],
    inputType: EmbeddingInputType = 'search_document',
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const modelId = await this.ensureResolved();

    if (texts.length === 1) {
      return [await this.embedOne(texts[0], inputType, modelId)];
    }

    // Sequential: the gateway is flaky and large parallel bursts triggered
    // connection drops during integration testing.
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embedOne(text, inputType, modelId));
    }
    return embeddings;
  }

  /**
   * Resolves (once) the first candidate model that answers a probe, and pins
   * it for the process lifetime. Concurrent callers share the in-flight
   * resolution; a failed resolution is retried on the next call.
   */
  private ensureResolved(): Promise<string> {
    if (this.resolvedModel) return Promise.resolve(this.resolvedModel);
    if (!this.resolutionPromise) {
      this.resolutionPromise = this.resolveModels()
        .then((model) => {
          this.resolvedModel = model;
          return model;
        })
        .finally(() => {
          this.resolutionPromise = null;
        });
    }
    return this.resolutionPromise;
  }

  private async resolveModels(): Promise<string> {
    let lastError: unknown;
    for (const model of this.candidateModels) {
      try {
        const vector = await this.requestEmbedding(
          'probe',
          'search_document',
          model,
        );
        this.resolvedDimensions = vector.length;
        if (model !== this.candidateModels[0]) {
          this.logger.warn(
            `Bedrock embedding resolved to "${model}" (primary "${this.candidateModels[0]}" unavailable). ${vector.length}-dim vectors — previously indexed vectors may live in a different model space.`,
          );
        } else {
          this.logger.log(
            `Bedrock embedding model resolved: ${model} (${vector.length} dims)`,
          );
        }
        return model;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Bedrock embedding model "${model}" unavailable: ${(error as Error).message}`,
        );
      }
    }

    // No candidate model worked. Mark the aggregate failure as transient so
    // AiProviderService falls through to the next provider (Gemini →
    // quarantine) instead of killing the pipeline; per-model failures are
    // already logged above for visibility.
    const aggregate = new Error(
      `No Bedrock embedding model resolved (tried: ${this.candidateModels.join(', ')}). Last failure: ${(lastError as Error)?.message ?? 'unknown'}`,
    ) as Error & { name?: string };
    aggregate.name = 'ServiceUnavailableException';
    throw aggregate;
  }

  private async embedOne(
    text: string,
    inputType: EmbeddingInputType,
    modelId: string,
  ): Promise<number[]> {
    return this.requestEmbedding(text, inputType, modelId);
  }

  private async requestEmbedding(
    text: string,
    inputType: EmbeddingInputType,
    modelId: string,
  ): Promise<number[]> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/student/embed`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: modelId,
        texts: [text],
        input_type: inputType,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const body = await response.text().catch(() => '');
      const error = new Error(
        `Bedrock gateway embedding request failed with status ${status}: ${body}`,
      ) as Error & { status?: number };
      error.status = status;
      throw error;
    }

    const payload = (await response.json()) as {
      embeddings?: number[][];
      data?: Array<{ embedding?: number[] }>;
    };

    const raw =
      payload?.embeddings ??
      payload?.data?.map((entry) => entry.embedding) ??
      null;

    if (!Array.isArray(raw) || raw.length !== 1) {
      throw new Error(
        `Invalid embedding response from Bedrock gateway: expected 1 embedding`,
      );
    }

    const [vector] = raw;
    if (!Array.isArray(vector) || vector.some((v) => typeof v !== 'number')) {
      throw new Error('Invalid embedding vector from Bedrock gateway');
    }

    return vector;
  }
}
