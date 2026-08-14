import { Injectable } from '@nestjs/common';
import { GeminiService } from '../../gemini/gemini.service';
import { AiProviderService } from '../../ai-provider/ai-provider.service';
import { AgentCitation, RetrievalHit } from '../dto/retrieval-hit.dto';

export interface SynthesizeResult {
  answer: string;
  citations: AgentCitation[];
}

@Injectable()
export class SynthesizerService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly aiProvider: AiProviderService,
  ) {}

  private systemInstruction(responseStyle?: 'text' | 'voice'): string {
    const base = [
      'You answer questions about a code repository using ONLY the provided context.',
      'For every factual claim, include an inline citation like [filePath:lineRange] when lineRange is known, otherwise [filePath].',
      'If the context does not cover the question, say you do not know — do not invent repository details.',
      'Be concise and precise.',
    ];

    if (responseStyle === 'voice') {
      base.push(
        'This answer will be read aloud.',
        'Keep the response conversational and concise — 2 to 4 short sentences.',
        'Name real files and functions when useful but avoid reading long paths verbatim.',
        'Never invent symbols, file names, or architecture.',
        'If the context is insufficient, explicitly say so.',
      );
    }

    return base.join(' ');
  }

  async synthesize(
    question: string,
    contextText: string,
    selectedHits: RetrievalHit[],
    responseStyle?: 'text' | 'voice',
    model?: string,
  ): Promise<SynthesizeResult> {
    const prompt = [
      `Question: ${question}`,
      '',
      'Context:',
      contextText || '(no context retrieved)',
      '',
      'Answer:',
    ].join('\n');

    let answer = '';
    if (model && model !== 'gemini') {
      const res = await this.aiProvider.answerQuestion(question, contextText, {
        overrideModel: model,
      });
      answer = res.text;
    } else {
      answer = await this.gemini.generateContent(
        `${this.systemInstruction(responseStyle)}\n\n${prompt}`,
      );
    }

    return {
      answer,
      citations: this.citationsFromHits(selectedHits),
    };
  }

  async *synthesizeStream(
    question: string,
    contextText: string,
    selectedHits: RetrievalHit[],
    responseStyle?: 'text' | 'voice',
    model?: string,
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
    if (model && model !== 'gemini') {
      const res = await this.aiProvider.answerQuestion(question, contextText, {
        overrideModel: model,
      });
      answer = res.text;
      yield { type: 'token', data: answer };
    } else {
      for await (const token of this.gemini.generateContentStream({
        systemInstruction: this.systemInstruction(responseStyle),
        prompt,
      })) {
        answer += token;
        yield { type: 'token', data: token };
      }
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
