import { Injectable } from '@nestjs/common';
import { GeminiService } from '../../gemini/gemini.service';
import { AgentCitation, RetrievalHit } from '../dto/retrieval-hit.dto';

export interface SynthesizeResult {
  answer: string;
  citations: AgentCitation[];
}

@Injectable()
export class SynthesizerService {
  constructor(private readonly gemini: GeminiService) {}

  private systemInstruction(): string {
    return [
      'You answer questions about a code repository using ONLY the provided context.',
      'For every factual claim, include an inline citation like [filePath:lineRange] when lineRange is known, otherwise [filePath].',
      'If the context does not cover the question, say you do not know — do not invent repository details.',
      'Be concise and precise.',
    ].join(' ');
  }

  async synthesize(
    question: string,
    contextText: string,
    selectedHits: RetrievalHit[],
  ): Promise<SynthesizeResult> {
    const prompt = [
      `Question: ${question}`,
      '',
      'Context:',
      contextText || '(no context retrieved)',
      '',
      'Answer:',
    ].join('\n');

    const answer = await this.gemini.generateContent(
      `${this.systemInstruction()}\n\n${prompt}`,
    );

    return {
      answer,
      citations: this.citationsFromHits(selectedHits),
    };
  }

  async *synthesizeStream(
    question: string,
    contextText: string,
    selectedHits: RetrievalHit[],
  ): AsyncGenerator<{ type: 'token' | 'done'; data: unknown }> {
    const prompt = [
      `Question: ${question}`,
      '',
      'Context:',
      contextText || '(no context retrieved)',
      '',
      'Answer:',
    ].join('\n');

    let answer = '';
    for await (const token of this.gemini.generateContentStream({
      systemInstruction: this.systemInstruction(),
      prompt,
    })) {
      answer += token;
      yield { type: 'token', data: token };
    }

    const citations = this.citationsFromHits(selectedHits);
    yield {
      type: 'done',
      data: { answer, citations },
    };
  }

  private citationsFromHits(hits: RetrievalHit[]): AgentCitation[] {
    const seen = new Set<string>();
    const citations: AgentCitation[] = [];
    for (const hit of hits) {
      if (!hit.filePath) continue;
      const key = `${hit.nodeId}:${hit.filePath}:${hit.lineRange || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        filePath: hit.filePath,
        lineRange: hit.lineRange,
        nodeId: hit.nodeId,
      });
    }
    return citations;
  }
}
