import { Injectable, Logger } from '@nestjs/common';
import { AGENT_PLANNER_MAX_ITERATIONS } from '../agent-rag.constants';
import { AgentCitation, RetrievalHit } from '../dto/retrieval-hit.dto';
import { TavilyResult } from '../retrieval/tavily-search.service';
import { CitationSnippetService } from '../retrieval/citation-snippet.service';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';
import { ContextBuilderService } from './context-builder.service';
import { SynthesizerService } from './synthesizer.service';
import { FollowupGeneratorService } from './followup-generator.service';
import { AnswerCacheService } from '../retrieval/answer-cache.service';
import { FastAnswerService } from './fast-answer.service';

export interface AgentLoopResult {
  answer: string;
  citations: AgentCitation[];
  citedNodeIds: string[];
  toolsUsed: string[];
  contextNodeIds: string[];
  followups?: string[];
}

@Injectable()
export class AgentLoopService {
  private readonly logger = new Logger(AgentLoopService.name);

  constructor(
    private readonly planner: PlannerService,
    private readonly executor: ExecutorService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly synthesizer: SynthesizerService,
    private readonly followupGenerator: FollowupGeneratorService,
    private readonly answerCache: AnswerCacheService,
    private readonly fastAnswer: FastAnswerService,
    private readonly snippets: CitationSnippetService,
  ) {}

  async run(params: {
    repositoryId: string;
    question: string;
    recentNodeIds?: string[];
    conversationHistory?: { q: string; a: string }[];
    responseStyle?: 'text' | 'voice';
    model?: string;
  }): Promise<AgentLoopResult> {
    const isSingleTurn =
      !params.conversationHistory || params.conversationHistory.length === 0;
    if (isSingleTurn) {
      const cached = await this.answerCache.get(
        params.repositoryId,
        params.question,
      );
      if (cached) {
        this.logger.log(`Answer cache hit for question: "${params.question}"`);
        return cached;
      }
    }

    const collected: RetrievalHit[] = [];
    const allWebResults: TavilyResult[] = [];
    const toolsUsed: string[] = [];
    let priorSummary = '';

    for (let i = 0; i < AGENT_PLANNER_MAX_ITERATIONS; i++) {
      const plan = await this.planner.plan({
        question: params.question,
        recentNodeIds: params.recentNodeIds,
        priorToolResultsSummary: priorSummary || undefined,
        conversationHistory: params.conversationHistory,
      });

      if (!plan.functionCalls.length) {
        break;
      }

      const executed = await this.executor.execute(
        params.repositoryId,
        plan.functionCalls,
      );
      toolsUsed.push(...executed.toolsUsed);
      collected.push(...executed.hits);
      allWebResults.push(...(executed.webResults ?? []));
      priorSummary = this.summarizeHits(executed.hits);

      if (executed.hits.length === 0 && i > 0) {
        break;
      }
    }

    // Fallback: if planner never retrieved, run hybrid once.
    if (collected.length === 0) {
      const executed = await this.executor.execute(params.repositoryId, [
        { name: 'hybrid_search', args: { query: params.question, k: 8 } },
      ]);
      toolsUsed.push(...executed.toolsUsed);
      collected.push(...executed.hits);
      allWebResults.push(...(executed.webResults ?? []));
    }

    const { contextText, selectedHits } = this.contextBuilder.build(collected);
    const webContextBlock = this.formatWebContext(allWebResults);
    const { answer, citations: rawCitations } = await this.synthesizer.synthesize(
      params.question,
      contextText + webContextBlock,
      selectedHits,
      params.responseStyle,
      params.model,
    );
    const citations = await this.snippets.enrich(
      params.repositoryId,
      rawCitations,
    );

    const citedNodeIds = [
      ...new Set(citations.map((c) => c.nodeId).filter(Boolean)),
    ];
    const contextNodeIds = selectedHits.map((h) => h.nodeId);

    const followups = await this.followupGenerator.generate(
      params.question,
      answer,
    );

    const result: AgentLoopResult = {
      answer,
      citations,
      citedNodeIds,
      toolsUsed: [...new Set(toolsUsed)],
      contextNodeIds,
      followups,
    };

    if (isSingleTurn) {
      await this.answerCache.set(params.repositoryId, params.question, result);
    }

    this.logger.log(
      JSON.stringify({
        question: params.question.slice(0, 200),
        toolsCalled: toolsUsed,
        contextNodeIds,
        answerPreview: answer.slice(0, 200),
      }),
    );

    return result;
  }

  /**
   * Plan/execute server-side, then stream synthesizer tokens.
   */
  async *runStream(params: {
    repositoryId: string;
    question: string;
    recentNodeIds?: string[];
    conversationHistory?: { q: string; a: string }[];
    responseStyle?: 'text' | 'voice';
    model?: string;
  }): AsyncGenerator<{
    event: 'mode' | 'scanning' | 'web_source' | 'token' | 'citation' | 'done' | 'followups' | 'error';
    data: unknown;
  }> {
    try {
      const isSingleTurn =
        !params.conversationHistory || params.conversationHistory.length === 0;
      if (isSingleTurn) {
        const cached = await this.answerCache.get(
          params.repositoryId,
          params.question,
        );
        if (cached) {
          this.logger.log(
            `Answer cache hit for stream question: "${params.question}"`,
          );
          yield { event: 'mode', data: 'standard' };
          for (const c of cached.citations) {
            if (c.filePath) {
              yield { event: 'scanning', data: { filePath: c.filePath, tool: 'cache' } };
            }
          }
          for (const c of cached.citations) {
            yield { event: 'citation', data: c };
          }
          yield { event: 'token', data: cached.answer };
          yield {
            event: 'done',
            data: {
              citations: cached.citations,
              citedNodeIds: cached.citedNodeIds,
              toolsUsed: cached.toolsUsed,
              answer: cached.answer,
              followups: cached.followups,
            },
          };
          if (cached.followups && cached.followups.length > 0) {
            yield { event: 'followups', data: cached.followups };
          }
          return;
        }

        const fastResult = await this.fastAnswer.findFastAnswer(
          params.repositoryId,
          params.question,
        );
        if (fastResult) {
          yield { event: 'mode', data: 'fast' };
          const fastCitations = await this.snippets.enrich(
            params.repositoryId,
            fastResult.citations,
          );
          for (const c of fastCitations) {
            if (c.filePath) {
              yield { event: 'scanning', data: { filePath: c.filePath, tool: 'fast_answer_wiki' } };
            }
          }
          for (const c of fastCitations) {
            yield { event: 'citation', data: c };
          }
          yield { event: 'token', data: fastResult.answer };
          const followups = await this.followupGenerator.generate(
            params.question,
            fastResult.answer,
          );
          yield {
            event: 'done',
            data: {
              citations: fastCitations,
              citedNodeIds: [],
              toolsUsed: ['fast_answer_wiki'],
              answer: fastResult.answer,
              followups,
            },
          };
          if (followups.length > 0) {
            yield { event: 'followups', data: followups };
          }
          return;
        }
      }

      yield { event: 'mode', data: 'standard' };

      const collected: RetrievalHit[] = [];
      const allWebResults: TavilyResult[] = [];
      const toolsUsed: string[] = [];
      let priorSummary = '';
      const scannedFiles = new Set<string>();

      for (let i = 0; i < AGENT_PLANNER_MAX_ITERATIONS; i++) {
        const plan = await this.planner.plan({
          question: params.question,
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
            yield { event: 'scanning', data: { filePath: hit.filePath, tool: repoTool } };
          }
        }

        for (const web of executed.webResults ?? []) {
          yield { event: 'web_source', data: web };
        }

        if (executed.hits.length === 0 && i > 0) break;
      }

      if (collected.length === 0) {
        const executed = await this.executor.execute(params.repositoryId, [
          { name: 'hybrid_search', args: { query: params.question, k: 8 } },
        ]);
        toolsUsed.push(...executed.toolsUsed);
        collected.push(...executed.hits);
        for (const hit of executed.hits) {
          if (hit.filePath && !scannedFiles.has(hit.filePath)) {
            scannedFiles.add(hit.filePath);
            yield { event: 'scanning', data: { filePath: hit.filePath, tool: 'hybrid_search' } };
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

      for await (const chunk of this.synthesizer.synthesizeStream(
        params.question,
        contextText + webContextBlock,
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
      const contextNodeIds = selectedHits.map((h) => h.nodeId);

      const followups = await this.followupGenerator.generate(
        params.question,
        answer,
      );

      const loopResult: AgentLoopResult = {
        answer,
        citations,
        citedNodeIds,
        toolsUsed: [...new Set(toolsUsed)],
        contextNodeIds,
        followups,
      };

      if (isSingleTurn) {
        await this.answerCache.set(
          params.repositoryId,
          params.question,
          loopResult,
        );
      }

      this.logger.log(
        JSON.stringify({
          question: params.question.slice(0, 200),
          toolsCalled: [...new Set(toolsUsed)],
          contextNodeIds,
          answerPreview: answer.slice(0, 200),
        }),
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
