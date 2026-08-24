import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../../gemini/gemini.service';

@Injectable()
export class FollowupGeneratorService {
  private readonly logger = new Logger(FollowupGeneratorService.name);

  constructor(private readonly gemini: GeminiService) {}

  async generate(question: string, answer: string): Promise<string[]> {
    try {
      const prompt = [
        'Given this question and answer about a code repository:',
        `Question: ${question}`,
        `Answer: ${answer.slice(0, 1500)}`,
        '',
        'Suggest 3 logical follow-up questions a developer might ask next.',
        'Rules:',
        '- Each question must be answerable from THIS repository (its code, structure, or behavior) — not generic advice.',
        '- Reference concrete files, classes, or modules mentioned in the answer where possible.',
        '- Vary the angle: one drilling deeper, one about relationships/usage, one about edge cases or configuration.',
        'Return ONLY a JSON array of 3 strings. Example: ["How does AgentLoopService handle tool failures?", "Which modules depend on ChromaService?", "What happens when the embedding provider is down?"]',
        'Do not wrap in markdown block quotes or extra text.',
      ].join('\n');

      const raw = await this.gemini.generateContent(prompt);
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return parsed.slice(0, 3);
      }
      return [];
    } catch (error) {
      this.logger.warn(
        `Failed to generate follow-up questions: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
