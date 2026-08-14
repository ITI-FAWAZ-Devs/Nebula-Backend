import { Injectable } from '@nestjs/common';
import { RetrievalHit } from '../dto/retrieval-hit.dto';
import { VectorRetrievalService } from './vector-retrieval.service';
import { GraphRetrievalService } from './graph-retrieval.service';
import { RerankerService } from './reranker.service';
import { HitEnricherService } from './hit-enricher.service';

@Injectable()
export class HybridRetrievalService {
  constructor(
    private readonly vector: VectorRetrievalService,
    private readonly graph: GraphRetrievalService,
    private readonly reranker: RerankerService,
    private readonly enricher: HitEnricherService,
  ) {}

  /**
   * Vector hits → extract paths → expand via graph tools → merge/dedupe → rerank.
   */
  async retrieve(
    repositoryId: string,
    query: string,
    k = 8,
  ): Promise<RetrievalHit[]> {
    const vectorHits = await this.vector.search(repositoryId, query, k);
    const filePaths = [
      ...new Set(
        vectorHits
          .map((h) => h.filePath)
          .filter((p): p is string => !!p && p.length > 0),
      ),
    ].slice(0, 5);

    const expansions = await Promise.all(
      filePaths.flatMap((filePath) => [
        this.graph.getFileContext(repositoryId, filePath),
        this.graph.getModuleOverview(repositoryId, filePath),
      ]),
    );

    const merged = this.dedupeByNodeId([...vectorHits, ...expansions.flat()]);

    const enriched = await this.enricher.enrich(repositoryId, merged);
    return this.reranker.rerank(query, enriched);
  }

  private dedupeByNodeId(hits: RetrievalHit[]): RetrievalHit[] {
    const byId = new Map<string, RetrievalHit>();
    for (const hit of hits) {
      const existing = byId.get(hit.nodeId);
      if (!existing || hit.score > existing.score) {
        byId.set(hit.nodeId, hit);
      } else if (existing && hit.content.length > existing.content.length) {
        byId.set(hit.nodeId, { ...existing, content: hit.content });
      }
    }
    return [...byId.values()];
  }
}
