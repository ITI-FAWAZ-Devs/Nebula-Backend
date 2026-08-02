import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../gemini/gemini.service';
import { EmbeddingProvider } from './interfaces/embedding-provider.interface';

/**
 * Adapter exposing the existing GeminiService embedding calls behind the
 * EmbeddingProvider interface. Internal Gemini logic is unchanged.
 */
@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimensions: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly gemini: GeminiService,
  ) {
    this.model =
      this.configService.get<string>('gemini.embeddingModel') ||
      'text-embedding-004';
    this.dimensions =
      this.configService.get<number>('gemini.embeddingDimensions') || 768;
  }

  async embedString(text: string): Promise<number[]> {
    return this.gemini.embedString(text);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return this.gemini.embedMany(texts);
  }
}
