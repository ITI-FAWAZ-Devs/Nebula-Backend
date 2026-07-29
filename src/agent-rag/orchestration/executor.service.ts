import { Injectable, Logger } from '@nestjs/common';
import { GeminiFunctionCall } from '../../gemini/gemini.service';
import { RetrievalHit } from '../dto/retrieval-hit.dto';
import { VectorRetrievalService } from '../retrieval/vector-retrieval.service';
import { GraphRetrievalService } from '../retrieval/graph-retrieval.service';
import { HybridRetrievalService } from '../retrieval/hybrid-retrieval.service';

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    private readonly vector: VectorRetrievalService,
    private readonly graph: GraphRetrievalService,
    private readonly hybrid: HybridRetrievalService,
  ) {}

  /**
   * Runs selected tool calls in parallel when independent.
   */
  async execute(
    repositoryId: string,
    calls: GeminiFunctionCall[],
  ): Promise<{ hits: RetrievalHit[]; toolsUsed: string[] }> {
    if (calls.length === 0) {
      return { hits: [], toolsUsed: [] };
    }

    const results = await Promise.all(
      calls.map(async (call) => {
        try {
          const hits = await this.dispatch(repositoryId, call);
          return { name: call.name, hits };
        } catch (error) {
          this.logger.warn(
            `Tool ${call.name} failed: ${(error as Error).message}`,
          );
          return { name: call.name, hits: [] as RetrievalHit[] };
        }
      }),
    );

    return {
      hits: results.flatMap((r) => r.hits),
      toolsUsed: results.map((r) => r.name),
    };
  }

  private async dispatch(
    repositoryId: string,
    call: GeminiFunctionCall,
  ): Promise<RetrievalHit[]> {
    const args = call.args || {};
    switch (call.name) {
      case 'vector_search':
        return this.vector.search(
          repositoryId,
          String(args.query || ''),
          typeof args.k === 'number' ? args.k : 10,
          {
            filePath:
              typeof args.filePath === 'string' ? args.filePath : undefined,
            language:
              typeof args.language === 'string' ? args.language : undefined,
          },
        );
      case 'hybrid_search':
        return this.hybrid.retrieve(
          repositoryId,
          String(args.query || ''),
          typeof args.k === 'number' ? args.k : 8,
        );
      case 'getDefinition':
        return this.graph.getDefinition(repositoryId, {
          nodeId: typeof args.nodeId === 'string' ? args.nodeId : undefined,
          name: typeof args.name === 'string' ? args.name : undefined,
          type: typeof args.type === 'string' ? args.type : undefined,
        });
      case 'getCallers':
        return this.graph.getCallers(repositoryId, String(args.nodeId || ''));
      case 'getCallees':
        return this.graph.getCallees(repositoryId, String(args.nodeId || ''));
      case 'getImplementations':
        return this.graph.getImplementations(
          repositoryId,
          String(args.nodeId || ''),
        );
      case 'getFileContext':
        return this.graph.getFileContext(
          repositoryId,
          String(args.filePath || ''),
        );
      case 'getModuleOverview':
        return this.graph.getModuleOverview(
          repositoryId,
          String(args.filePath || ''),
        );
      default:
        this.logger.warn(`Unknown tool: ${call.name}`);
        return [];
    }
  }
}
