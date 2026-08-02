import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  FunctionDeclarationsTool,
} from '@google/generative-ai';
import { buildFileDescriptionPrompt, buildAnswerQuestionPrompt } from './prompts';

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GenerateWithToolsResult {
  text?: string;
  functionCalls: GeminiFunctionCall[];
}

export interface RelevanceCandidate {
  id: string;
  content: string;
}

export interface RelevanceScore {
  id: string;
  score: number;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly llmModelName: string;
  private readonly llmModelInstance: GenerativeModel;
  private readonly embeddingModelInstance: GenerativeModel;
  private readonly embeddingDimensions?: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const llmModelName =
      this.configService.get<string>('gemini.llmModel') || 'gemini-2.5-flash';
    const embeddingModelName =
      this.configService.get<string>('gemini.embeddingModel') ||
      'text-embedding-004';
    this.embeddingDimensions = this.configService.get<number>(
      'gemini.embeddingDimensions',
    );

    if (!apiKey) {
      this.logger.warn('Gemini API key is not configured');
    }

    this.genAI = new GoogleGenerativeAI(apiKey || '');
    this.llmModelInstance = this.genAI.getGenerativeModel({
      model: llmModelName,
    });
    this.embeddingModelInstance = this.genAI.getGenerativeModel({
      model: embeddingModelName,
    });
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
      this.logger.error(
        `Failed to describe file ${filePath}: ${(error as Error).message}`,
      );
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
      this.logger.error(
        `Failed to answer question: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Generates content using the configured LLM model.
   */
  async generateContent(prompt: string): Promise<string> {
    try {
      const result = await this.llmModelInstance.generateContent(prompt);
      const responseText = result.response.text();
      if (!responseText) {
        throw new Error('Empty response from Gemini');
      }
      return responseText;
    } catch (error) {
      this.logger.error(
        `Failed to generate content: ${(error as Error).message}`,
      );
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

  /**
   * One function-calling turn: the model may either answer directly or
   * request one or more tool invocations. Tool schemas are supplied by the
   * caller (the agent planner) — this method never invents or executes SQL/Cypher.
   */
  async generateWithTools(params: {
    systemInstruction: string;
    contents: Content[];
    tools: FunctionDeclarationsTool[];
  }): Promise<GenerateWithToolsResult> {
    try {
      const result = await this.llmModelInstance.generateContent({
        systemInstruction: params.systemInstruction,
        contents: params.contents,
        tools: params.tools,
      });

      const response = result.response;
      const functionCalls = (response.functionCalls() || []).map((call) => ({
        name: call.name,
        args: (call.args || {}) as Record<string, unknown>,
      }));

      let text: string | undefined;
      try {
        text = response.text();
      } catch {
        text = undefined;
      }

      return { text, functionCalls };
    } catch (error) {
      this.logger.error(`Failed to generate with tools: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Streams the final synthesized answer token-by-token for SSE responses.
   */
  async *generateContentStream(params: {
    systemInstruction: string;
    prompt: string;
  }): AsyncIterable<string> {
    try {
      const streamModel = this.genAI.getGenerativeModel({
        model: this.llmModelName,
        systemInstruction: params.systemInstruction,
      });
      const result = await streamModel.generateContentStream(params.prompt);
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          yield chunkText;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to stream content: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Cheap LLM-based reranker: scores each candidate's relevance to the query
   * in a single batched JSON call (0-1). Used instead of a cross-encoder.
   */
  async scoreRelevance(
    query: string,
    candidates: RelevanceCandidate[],
  ): Promise<RelevanceScore[]> {
    if (candidates.length === 0) {
      return [];
    }

    const prompt = [
      'You are scoring how relevant each candidate is to a search query.',
      'Return ONLY a JSON array of objects: [{ "id": string, "score": number }].',
      'Score must be a number between 0 and 1 (1 = highly relevant, 0 = irrelevant).',
      'Do not include any prose, markdown, or explanation — JSON only.',
      '',
      `Query: ${query}`,
      '',
      'Candidates:',
      ...candidates.map((c, i) => `${i + 1}. id="${c.id}"\n${c.content.slice(0, 500)}`),
    ].join('\n');

    try {
      const result = await this.llmModelInstance.generateContent(prompt);
      const responseText = result.response.text().trim();
      const jsonText = this.extractJsonArray(responseText);
      const parsed = JSON.parse(jsonText) as Array<{ id: string; score: number }>;

      const byId = new Map(parsed.map((p) => [p.id, p.score]));
      return candidates.map((c) => ({
        id: c.id,
        score: this.clampScore(byId.get(c.id)),
      }));
    } catch (error) {
      this.logger.warn(
        `Relevance scoring failed, falling back to neutral scores: ${(error as Error).message}`,
      );
      return candidates.map((c) => ({ id: c.id, score: 0.5 }));
    }
  }

  private extractJsonArray(text: string): string {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {
      throw new Error('No JSON array found in relevance scoring response');
    }
    return text.slice(start, end + 1);
  }

  private clampScore(value: unknown): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : 0.5;
    return Math.min(1, Math.max(0, n));
  }
}
