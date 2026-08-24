import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../../gemini/gemini.service';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';
import { ContextBuilderService } from './context-builder.service';
import { SynthesizerService } from './synthesizer.service';
import { FollowupGeneratorService } from './followup-generator.service';
import { RetrievalHit, AgentCitation } from '../dto/retrieval-hit.dto';
import { TavilyResult } from '../retrieval/tavily-search.service';
import { CitationSnippetService } from '../retrieval/citation-snippet.service';
import {
  DEEP_RESEARCH_MAX_SUB_QUESTIONS,
  DEEP_RESEARCH_MAX_ITERATIONS,
} from '../agent-rag.constants';

@Injectable()
export class DeepResearchService {
  private readonly logger = new Logger(DeepResearchService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly planner: PlannerService,
    private readonly executor: ExecutorService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly synthesizer: SynthesizerService,
    private readonly followupGenerator: FollowupGeneratorService,
    private readonly snippets: CitationSnippetService,
  ) {}

  async decomposeQuestion(question: string): Promise<string[]> {
    try {
      const prompt = [
        'You are an expert software architecture investigator.',
        `User request: "${question}"`,
        '',
        `Break down this query into 2 to ${DEEP_RESEARCH_MAX_SUB_QUESTIONS} focused, technical sub-questions that must be answered to thoroughly investigate the codebase.`,
        'Rules:',
        '- Each sub-question must be SELF-CONTAINED: repeat entity names from the original request instead of pronouns like "it" or "that".',
        "- Each must be answerable by searching this repository's code (files, classes, call relationships, configuration).",
        '- Cover different aspects: entry points, data flow, dependencies, error handling, or persistence — as relevant.',
        'Return ONLY a JSON array of strings. Example: ["Where is authentication initiated in the backend?", "How are JWT tokens validated and which service does it?", "How is session state persisted between requests?"]',
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
        parsed.length > 0 &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return parsed.slice(0, DEEP_RESEARCH_MAX_SUB_QUESTIONS);
      }
      return [question];
    } catch (error) {
      this.logger.warn(
        `Failed to decompose question, falling back to original query: ${(error as Error).message}`,
      );
      return [question];
    }
  }

  async *runStream(params: {
    repositoryId: string;
    question: string;
    recentNodeIds?: string[];
    conversationHistory?: { q: string; a: string }[];
    responseStyle?: 'text' | 'voice';
    model?: string;
  }): AsyncGenerator<{
    event:
      | 'mode'
      | 'progress'
      | 'scanning'
      | 'web_source'
      | 'token'
      | 'citation'
      | 'done'
      | 'followups'
      | 'error';
    data: unknown;
  }> {
    try {
      yield { event: 'mode', data: 'deep' };

      const subQuestions = await this.decomposeQuestion(params.question);
      this.logger.log(
        `Deep research decomposed question into ${subQuestions.length} sub-questions`,
      );

      const collected: RetrievalHit[] = [];
      const allWebResults: TavilyResult[] = [];
      const toolsUsed: string[] = [];
      const scannedFiles = new Set<string>();

      for (let index = 0; index < subQuestions.length; index++) {
        const subQ = subQuestions[index];
        yield {
          event: 'progress',
          data: {
            step: index + 1,
            total: subQuestions.length,
            subQuestion: subQ,
          },
        };

        let priorSummary = '';
        const iterations = Math.min(2, DEEP_RESEARCH_MAX_ITERATIONS);

        for (let iter = 0; iter < iterations; iter++) {
          const plan = await this.planner.plan({
            question: subQ,
            recentNodeIds: params.recentNodeIds,
            priorToolResultsSummary: priorSummary || undefined,
            conversationHistory: params.conversationHistory,
          });

          if (!plan.functionCalls.length) break;

          const executed = await this.executor.execute(
            params.repositoryId,
            plan.functionCalls,
          );
          toolsUsed.push(...executed.toolsUsed);
          collected.push(...executed.hits);
          allWebResults.push(...(executed.webResults ?? []));
          priorSummary = this.summarizeHits(executed.hits);

          const repoTool =
            executed.toolsUsed.find((t) => t !== 'web_search') ??
            executed.toolsUsed[0] ??
            'search';
          for (const hit of executed.hits) {
            if (hit.filePath && !scannedFiles.has(hit.filePath)) {
              scannedFiles.add(hit.filePath);
              yield {
                event: 'scanning',
                data: { filePath: hit.filePath, tool: repoTool },
              };
            }
          }

          for (const web of executed.webResults ?? []) {
            yield { event: 'web_source', data: web };
          }

          if (executed.hits.length === 0 && iter > 0) break;
        }
      }

      // Fallback: if deep research gathered no hits, run hybrid search
      if (collected.length === 0) {
        const executed = await this.executor.execute(params.repositoryId, [
          { name: 'hybrid_search', args: { query: params.question, k: 8 } },
        ]);
        toolsUsed.push(...executed.toolsUsed);
        collected.push(...executed.hits);
        for (const hit of executed.hits) {
          if (hit.filePath && !scannedFiles.has(hit.filePath)) {
            scannedFiles.add(hit.filePath);
            yield {
              event: 'scanning',
              data: { filePath: hit.filePath, tool: 'hybrid_search' },
            };
          }
        }
      }

      const { contextText, selectedHits } =
        this.contextBuilder.build(collected);

      const webContextBlock = this.formatWebContext(allWebResults);

      let answer = '';
      let citations = await this.snippets.enrich(
        params.repositoryId,
        selectedHits
          .filter((h) => h.filePath)
          .map((h) => ({
            filePath: h.filePath as string,
            lineRange: h.lineRange,
            nodeId: h.nodeId,
            snippet: h.content || undefined,
          })),
      );

      for (const c of citations) {
        yield { event: 'citation', data: c };
      }

      const deepContextPrompt = [
        `Deep Research Context across ${subQuestions.length} sub-questions:`,
        subQuestions.map((q, i) => `Sub-question ${i + 1}: ${q}`).join('\n'),
        '',
        contextText + webContextBlock,
      ].join('\n');

      for await (const chunk of this.synthesizer.synthesizeStream(
        params.question,
        deepContextPrompt,
        selectedHits,
        params.responseStyle,
        params.model,
      )) {
        if (chunk.type === 'token') {
          answer += chunk.data as string;
          yield { event: 'token', data: chunk.data };
        } else if (chunk.type === 'done') {
          const done = chunk.data as {
            answer: string;
            citations: AgentCitation[];
          };
          answer = done.answer;
          citations = this.snippets.merge(done.citations, citations);
        }
      }

      const citedNodeIds = [
        ...new Set(citations.map((c) => c.nodeId).filter(Boolean)),
      ];

      const followups = await this.followupGenerator.generate(
        params.question,
        answer,
      );

      yield {
        event: 'done',
        data: {
          citations,
          citedNodeIds,
          toolsUsed: [...new Set(toolsUsed)],
          answer,
          followups,
        },
      };

      if (followups.length > 0) {
        yield {
          event: 'followups',
          data: followups,
        };
      }
    } catch (error) {
      yield {
        event: 'error',
        data: { message: (error as Error).message },
      };
    }
  }

  private formatWebContext(results: TavilyResult[]): string {
    if (results.length === 0) return '';
    return (
      '\n\n## Web search results (external, not from this repository)\n' +
      results
        .map((r, i) => `[Web ${i + 1}] ${r.title} (${r.url})\n${r.snippet}`)
        .join('\n\n')
    );
  }

  private summarizeHits(hits: RetrievalHit[]): string {
    return hits
      .slice(0, 10)
      .map(
        (h) =>
          `- ${h.nodeId} ${h.type} ${h.filePath || ''} score=${h.score.toFixed(2)}`,
      )
      .join('\n');
  }
}
