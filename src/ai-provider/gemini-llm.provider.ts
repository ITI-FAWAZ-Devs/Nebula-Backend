import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../gemini/gemini.service';
import {
  LlmProvider,
  LlmProviderResult,
} from './interfaces/llm-provider.interface';

/**
 * Adapter exposing the existing GeminiService LLM calls behind the
 * LlmProvider interface. Internal Gemini logic is unchanged.
 */
@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly gemini: GeminiService,
  ) {
    this.modelName =
      this.configService.get<string>('gemini.llmModel') || 'gemini-2.5-flash';
  }

  async generateContent(prompt: string): Promise<LlmProviderResult> {
    const text = await this.gemini.generateContent(prompt);
    return { text, model: this.modelName };
  }
}
