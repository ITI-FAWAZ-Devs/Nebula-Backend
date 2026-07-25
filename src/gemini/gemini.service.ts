import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { buildFileDescriptionPrompt, buildAnswerQuestionPrompt } from './prompts';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly llmModelInstance: GenerativeModel;
  private readonly embeddingModelInstance: GenerativeModel;
  private readonly embeddingDimensions?: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const llmModelName = this.configService.get<string>('gemini.llmModel') || 'gemini-2.5-flash';
    const embeddingModelName = this.configService.get<string>('gemini.embeddingModel') || 'text-embedding-004';
    this.embeddingDimensions = this.configService.get<number>('gemini.embeddingDimensions');

    if (!apiKey) {
      this.logger.warn('Gemini API key is not configured');
    }

    this.genAI = new GoogleGenerativeAI(apiKey || '');
    this.llmModelInstance = this.genAI.getGenerativeModel({ model: llmModelName });
    this.embeddingModelInstance = this.genAI.getGenerativeModel({ model: embeddingModelName });
  }

  /**
   * Describes a file's purpose, exports, dependencies, and notes.
   */
  async describeFile(filePath: string, content: string): Promise<string> {
    const prompt = buildFileDescriptionPrompt(filePath, content);
    try {
      const result = await this.llmModelInstance.generateContent(prompt);
      const responseText = result.response.text();
      if (!responseText) {
        throw new Error('Empty response from Gemini');
      }
      return responseText;
    } catch (error) {
      this.logger.error(`Failed to describe file ${filePath}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Answers a user's question grounded in the retrieved documentation context.
   */
  async answerQuestion(question: string, context: string): Promise<string> {
    const prompt = buildAnswerQuestionPrompt(question, context);
    try {
      const result = await this.llmModelInstance.generateContent(prompt);
      const responseText = result.response.text();
      if (!responseText) {
        throw new Error('Empty response from Gemini');
      }
      return responseText;
    } catch (error) {
      this.logger.error(`Failed to answer question: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Embeds a single string and returns its vector.
   */
  async embedString(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingModelInstance.embedContent(
        this.embeddingDimensions
          ? ({
              content: { role: 'user', parts: [{ text }] },
              outputDimensionality: this.embeddingDimensions,
            } as any)
          : text,
      );
      if (!result?.embedding?.values) {
        throw new Error('Invalid embedding response from Gemini');
      }
      return result.embedding.values;
    } catch (error) {
      this.logger.error(`Failed to embed string: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Embeds multiple strings sequentially to avoid rate-limit issues.
   */
  async embedMany(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embedString(text);
      results.push(embedding);
    }
    return results;
  }
}
