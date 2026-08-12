import { Injectable, Logger } from '@nestjs/common';
import { AGENT_PLANNER_MAX_ITERATIONS } from '../agent-rag.constants';
import { AgentCitation, RetrievalHit } from '../dto/retrieval-hit.dto';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';
import { ContextBuilderService } from './context-builder.service';
import { SynthesizerService } from './synthesizer.service';

export interface AgentLoopResult {
  answer: string;
  citations: AgentCitation[];
  citedNodeIds: string[];
  toolsUsed: string[];
  contextNodeIds: string[];
}

@Injectable()
export class AgentLoopService {
  private readonly logger = new Logger(AgentLoopService.name);

  constructor(
    private readonly planner: PlannerService,
    private readonly executor: ExecutorService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly synthesizer: SynthesizerService,
  ) {}

  async run(params: {
    repositoryId: string;
    question: string;
    recentNodeIds?: string[];
    responseStyle?: 'text' | 'voice';
  }): Promise<AgentLoopResult> {
    const collected: RetrievalHit[] = [];
    const toolsUsed: string[] = [];
    let priorSummary = '';

    for (let i = 0; i < AGENT_PLANNER_MAX_ITERATIONS; i++) {
      const plan = await this.planner.plan({
        question: params.question,
        recentNodeIds: params.recentNodeIds,
        priorToolResultsSummary: priorSummary || undefined,
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
    }

    const { contextText, selectedHits } = this.contextBuilder.build(collected);
    const { answer, citations } = await this.synthesizer.synthesize(
      params.question,
      contextText,
      selectedHits,
      params.responseStyle,
    );

    const citedNodeIds = [
      ...new Set(citations.map((c) => c.nodeId).filter(Boolean)),
    ];
    const contextNodeIds = selectedHits.map((h) => h.nodeId);

    this.logger.log(
      JSON.stringify({
        question: params.question.slice(0, 200),
        toolsCalled: toolsUsed,
        contextNodeIds,
        answerPreview: answer.slice(0, 200),
      }),
    );

    return {
      answer,
      citations,
      citedNodeIds,
      toolsUsed: [...new Set(toolsUsed)],
      contextNodeIds,
    };
  }

  /**
   * Plan/execute server-side, then stream synthesizer tokens.
   */
  async *runStream(params: {
    repositoryId: string;
    question: string;
    recentNodeIds?: string[];
    responseStyle?: 'text' | 'voice';
  }): AsyncGenerator<{
    event: 'token' | 'citation' | 'done' | 'error';
    data: unknown;
  }> {
    try {
      const collected: RetrievalHit[] = [];
      const toolsUsed: string[] = [];
      let priorSummary = '';

      for (let i = 0; i < AGENT_PLANNER_MAX_ITERATIONS; i++) {
        const plan = await this.planner.plan({
          question: params.question,
          recentNodeIds: params.recentNodeIds,
          priorToolResultsSummary: priorSummary || undefined,
        });

        if (!plan.functionCalls.length) break;

        const executed = await this.executor.execute(
          params.repositoryId,
          plan.functionCalls,
        );
        toolsUsed.push(...executed.toolsUsed);
        collected.push(...executed.hits);
        priorSummary = this.summarizeHits(executed.hits);
        if (executed.hits.length === 0 && i > 0) break;
      }

      if (collected.length === 0) {
        const executed = await this.executor.execute(params.repositoryId, [
          { name: 'hybrid_search', args: { query: params.question, k: 8 } },
        ]);
        toolsUsed.push(...executed.toolsUsed);
        collected.push(...executed.hits);
      }

      const { contextText, selectedHits } =
        this.contextBuilder.build(collected);

      let answer = '';
      let citations = selectedHits
        .filter((h) => h.filePath)
        .map((h) => ({
          filePath: h.filePath as string,
          lineRange: h.lineRange,
          nodeId: h.nodeId,
        }));

      for (const c of citations) {
        yield { event: 'citation', data: c };
      }

      for await (const chunk of this.synthesizer.synthesizeStream(
        params.question,
        contextText,
        selectedHits,
        params.responseStyle,
      )) {
        if (chunk.type === 'token') {
          answer += chunk.data as string;
          yield { event: 'token', data: chunk.data };
        } else if (chunk.type === 'done') {
          const done = chunk.data as {
            answer: string;
            citations: typeof citations;
          };
          answer = done.answer;
          citations = done.citations;
        }
      }

      const citedNodeIds = [
        ...new Set(citations.map((c) => c.nodeId).filter(Boolean)),
      ];
      const contextNodeIds = selectedHits.map((h) => h.nodeId);

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
        },
      };
    } catch (error) {
      yield {
        event: 'error',
        data: { message: (error as Error).message },
      };
    }
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
