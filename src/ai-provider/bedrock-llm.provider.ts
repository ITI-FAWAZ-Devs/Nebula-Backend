import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmProvider,
  LlmProviderOptions,
  LlmProviderResult,
} from './interfaces/llm-provider.interface';
import { withAbortSignal } from './fetch-timeout.util';

/**
 * Bedrock chat provider backed by the internal SBG gateway.
 *
 * Endpoint (confirmed live):
 *
 *   POST {base_url}/student/chat
 *   Authorization: Bearer {SBG_API_KEY}
 *   {
 *     "model_id": "openai.gpt-oss-120b-1:0",
 *     "messages": [{ "role": "user", "content": "..." }],
 *     "max_tokens": 16384
 *   }
 *
 *   Response: { "output_text": "...", "model_id": "...", "usage": {...},
 *               "estimated_cost_usd": "...", "actual_cost_usd": "...",
 *               "status": "active", "request_id": "..." }
 *
 * `max_tokens` MUST be set: the gateway's default exceeds the 64000-token
 * limit of claude-haiku and Bedrock rejects the call. Non-2xx responses throw
 * with the HTTP `status` attached so AiProviderService can classify 5xx as
 * transient (fall through to Gemini) and 4xx as loud failures.
 *
 * The gateway is flaky (drops connections under load), so network-level fetch
 * failures are retried up to `RETRY_ATTEMPTS` times with a short pause, each
 * attempt being logged. HTTP error responses are definitive and are NOT
 * retried. If the retries are exhausted the last error is wrapped (with the
 * underlying `cause` code preserved) so it still classifies as transient.
 *
 * `BEDROCK_LLM_MODEL` may be a comma-separated ordered list. Models are tried
 * in order: if one fails (network retries exhausted or an HTTP error), the
 * next model is attempted. The first success is returned; if every model
 * fails the last error is thrown (with `status`/`code` preserved).
 */
export const RETRY_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function describeNetworkError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const err = error as {
    message?: unknown;
    cause?: { message?: unknown; code?: unknown };
  };
  const message =
    typeof err.message === 'string' && err.message.length > 0
      ? err.message
      : '[non-Error object]';
  const cause = err.cause;
  if (cause && typeof cause === 'object') {
    const causeCode =
      typeof cause.code === 'string' && cause.code ? ` (${cause.code})` : '';
    if (
      typeof cause.message === 'string' &&
      cause.message &&
      cause.message !== message
    ) {
      return `${message}${causeCode}: ${cause.message}`;
    }
  }
  return message;
}

@Injectable()
export class BedrockGatewayLlmProvider implements LlmProvider {
  readonly name = 'bedrock';
  private readonly logger = new Logger(BedrockGatewayLlmProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly models: string[];
  private readonly strongModel: string;
  private readonly maxTokens: number;
  private readonly llmTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('aiProvider.sbgApiKey') || '';
    this.baseUrl =
      this.configService.get<string>('aiProvider.bedrockGatewayBaseUrl') || '';
    const configuredModels =
      this.configService.get<string[]>('aiProvider.bedrockLlmModels') ?? [];
    this.models =
      configuredModels.length > 0
        ? configuredModels
        : [
            this.configService.get<string>('aiProvider.bedrockLlmModel') ||
              'openai.gpt-oss-120b-1:0',
          ];
    this.strongModel =
      this.configService.get<string>('aiProvider.bedrockLlmModelStrong') ||
      this.models[0];
    this.maxTokens =
      this.configService.get<number>('aiProvider.bedrockMaxTokens') || 16384;
    this.llmTimeoutMs =
      this.configService.get<number>('aiProvider.llmTimeoutMs') ?? 60000;

    if (!this.apiKey) {
      this.logger.warn('SBG_API_KEY is not configured');
    }
    if (!this.baseUrl) {
      this.logger.warn(
        'BEDROCK_GATEWAY_BASE_URL is not configured; Bedrock LLM calls will fail',
      );
    }
  }

  async generateContent(
    prompt: string,
    options?: LlmProviderOptions,
  ): Promise<LlmProviderResult> {
    const tier = options?.tier ?? 'standard';
    const models = options?.overrideModel
      ? [options.overrideModel]
      : tier === 'strong'
      ? [this.strongModel]
      : this.models;

    if (!this.apiKey || !this.baseUrl) {
      throw new Error(
        `Bedrock gateway is not configured (SBG_API_KEY=${this.apiKey ? 'set' : 'missing'}, BEDROCK_GATEWAY_BASE_URL=${this.baseUrl ? 'set' : 'missing'})`,
      );
    }

    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/student/chat`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const modelId = models[0];
    try {
      return await this.chatWithRetries(prompt, modelId, endpoint, headers);
    } catch (error) {
      const httpStatus =
        typeof (error as { status?: unknown })?.status === 'number'
          ? ` (HTTP ${(error as { status: number }).status})`
          : '';
      this.logger.error(
        `Bedrock chat failed on model "${modelId}"${httpStatus}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private async chatWithRetries(
    prompt: string,
    modelId: string,
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<LlmProviderResult> {
    const requestInit: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model_id: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.maxTokens,
      }),
    };

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await withAbortSignal(this.llmTimeoutMs, (signal) =>
          fetch(endpoint, { ...requestInit, signal }),
        );
      } catch (error) {
        if (attempt < RETRY_ATTEMPTS) {
          this.logger.warn(
            `Bedrock chat attempt ${attempt}/${RETRY_ATTEMPTS} (model "${modelId}") failed with network error (${describeNetworkError(error)}); retrying in ${RETRY_DELAY_MS}ms`,
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw this.toExhaustedError(error, modelId);
      }

      if (!response.ok) {
        const status = response.status;
        const body = await response.text().catch(() => '');
        const error = new Error(
          `Bedrock gateway chat request failed with status ${status}: ${body}`,
        ) as Error & { status?: number };
        error.status = status;
        throw error;
      }

      const payload = (await response.json()) as { output_text?: unknown };
      if (typeof payload?.output_text !== 'string') {
        throw new Error(
          `Invalid chat response from Bedrock gateway (model "${modelId}"): missing output_text`,
        );
      }

      return { text: payload.output_text, model: modelId };
    }

    throw new Error(`Unreachable: retries exhausted for model "${modelId}"`);
  }

  /**
   * Wraps the final network error after all retries, keeping the underlying
   * `cause` code so the fallback classifier still treats it as transient.
   */
  private toExhaustedError(
    error: unknown,
    modelId: string,
  ): Error & { code?: string } {
    const wrapped = new Error(
      `Bedrock gateway chat request failed after ${RETRY_ATTEMPTS} attempts (model "${modelId}"): ${describeNetworkError(error)}`,
    ) as Error & { code?: string };
    Object.assign(wrapped, { cause: error });
    const causeCode = (error as { code?: string })?.code;
    if (typeof causeCode === 'string' && causeCode) {
      wrapped.code = causeCode;
    }
    return wrapped;
  }
}
