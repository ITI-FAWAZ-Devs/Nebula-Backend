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
      '## Citation contract (strict):',
      '- Every repository claim MUST be backed by a context block, cited inline as [filePath] — e.g. [src/auth/guard.ts].',
      '- Cite ONLY file paths that appear verbatim in the provided context headers. NEVER invent, abbreviate, or modify paths.',
      '- Do not add line numbers unless a context header explicitly shows them.',
      '- Only cite files you actually rely on for the explanation; do not cite everything you received.',
      '- Web results must be labeled "(external)" and never presented as repository facts; they are never cited as [filePath].',
      '',
      'Your response MUST follow this exact structure:',
      '',
      '## Answer',
      'A concise, precise technical explanation. Explain the concept or mechanism clearly.',
      'Mention key design decisions and trade-offs when relevant. Place citations next to the claims they support.',
      '',
      '## Where this shows up in the codebase',
      'Walk through the actual code locations using inline citations in the form [filePath], connecting how the pieces relate.',
      'Add a short comparison table when listing related processes, services, or modules.',
      '',
      'Guidelines:',
      '- Ground every repository claim in the provided context. Do NOT invent file names, function names, or architecture.',
      '- If the context does not cover something, say so explicitly — never guess.',
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
      'Context (each block starts with its citation header — cite files using exactly those paths):',
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
      citations: this.citationsFromAnswer(answer, selectedHits),
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
      'Context (each block starts with its citation header — cite files using exactly those paths):',
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

    const citations = this.citationsFromAnswer(answer, selectedHits);
    yield {
      type: 'done',
      data: { answer, citations },
    };
  }

  /**
   * Builds citations from the inline `[filePath]` / `[filePath:lineRange]`
   * markers the model actually emitted in its answer, validated against the
   * retrieved hits. Only files referenced by the answer are cited, in
   * first-appearance order — instead of every hit that was retrieved.
   * Line ranges always come from retrieval metadata (graph sourceLocation),
   * never from the model, to avoid hallucinated locations.
   */
  private citationsFromAnswer(
    answer: string,
    hits: RetrievalHit[],
  ): AgentCitation[] {
    const byPath = new Map<string, RetrievalHit>();
    for (const hit of hits) {
      if (!hit.filePath) continue;
      const existing = byPath.get(hit.filePath);
      if (!existing || hit.score > existing.score) {
        byPath.set(hit.filePath, hit);
      }
    }
    if (byPath.size === 0 || !answer) {
      return this.citationsFromHits(hits);
    }

    const cited = new Map<string, AgentCitation>();

    for (const match of answer.matchAll(/\[([^\[\]\n]+)\]/g)) {
      const token = match[1].trim();
      // Accept both `[path]` and `[path:12]` / `[path:12-20]`; the optional
      // range is only used for recognition, never as the citation location.
      const rangeMatch = token.match(/^(.+):(\d+(?:\s*-\s*\d+)?)$/);
      const path = (rangeMatch ? rangeMatch[1] : token).trim();
      const hit = byPath.get(path);
      if (!hit || cited.has(hit.nodeId)) continue;
      cited.set(hit.nodeId, {
        filePath: hit.filePath as string,
        lineRange: hit.lineRange,
        nodeId: hit.nodeId,
        snippet: hit.content || undefined,
      });
    }

    // Fallback when the model ignored the citation format.
    if (cited.size === 0) {
      return this.citationsFromHits(hits);
    }
    return [...cited.values()];
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
