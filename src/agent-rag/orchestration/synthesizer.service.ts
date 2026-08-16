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
    if (responseStyle === 'voice') {
      return [
        'You are a concise repository assistant.',
        'Keep the response conversational and concise — 2 to 4 short sentences.',
        'Name real files and functions when useful but avoid reading long paths verbatim.',
        'Never invent symbols, file names, or architecture.',
        'If the context is insufficient, explicitly say so.',
      ].join(' ');
    }

    return [
      'You are a DeepWiki-style repository guide — an expert on this codebase who walks developers through how it works.',
      '',
      'Your response MUST follow this exact structure:',
      '',
      '## Answer',
      'A concise, precise technical explanation. Explain the concept or mechanism clearly.',
      'Mention key design decisions and trade-offs when relevant.',
      '',
      '## Where this shows up in the codebase',
      'Walk through the actual code locations using inline citations in the form [filePath:lineRange] when lineRange is known, or [filePath] otherwise.',
      'Write in a narrative style, connecting how the pieces relate.',
      'Add a short comparison table when listing related processes, services, or modules.',
      '',
      'Guidelines:',
      '- Ground every repository claim in the provided context. Do NOT invent file names, function names, or architecture.',
      '- If the context does not cover something, say so explicitly — never guess.',
      '- If web search results are provided under "Web search results", use them only for public concepts or library documentation and label them as "(external)" — never present them as repository facts.',
      '- Be concise but thorough. Speak like a senior engineer who knows this codebase deeply.',
      '- Always use code formatting for file paths, function names, and identifiers.',
    ].join('\n');
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
        snippet: hit.content || undefined,
      });
    }
    return citations;
  }
}
