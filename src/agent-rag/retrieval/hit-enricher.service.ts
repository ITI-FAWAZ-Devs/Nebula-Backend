import { Injectable, Logger } from '@nestjs/common';
import { ChromaService } from '../../chroma/chroma.service';
import { GeminiService } from '../../gemini/gemini.service';
import { RetrievalHit } from '../dto/retrieval-hit.dto';
import {
  buildGraphSummary,
  normalizeSourceLocation,
} from '../utils/source-location';
import { EntityType } from '../../graph/interfaces/entity.interface';
import { GraphToolNode } from '../../neo4j/neo4j.service';

/**
 * Joins graph hits to Chroma file descriptions by filePath.
 * Falls back to a short graph summary when no description exists.
 */
@Injectable()
export class HitEnricherService {
  private readonly logger = new Logger(HitEnricherService.name);

  constructor(
    private readonly chroma: ChromaService,
    private readonly gemini: GeminiService,
  ) {}

  mapGraphNode(node: GraphToolNode, score = 0.5): RetrievalHit {
    const type = (node.labels[0] as EntityType) || 'File';
    const lineRange = normalizeSourceLocation(node.sourceLocation);
    return {
      nodeId: node.id,
      type,
      filePath: node.filePath,
      lineRange,
      content: buildGraphSummary({
        type,
        name: node.name || node.id,
        filePath: node.filePath,
        lineRange,
      }),
      score,
      source: 'graph',
    };
  }

  async enrich(
    repositoryId: string,
    hits: RetrievalHit[],
  ): Promise<RetrievalHit[]> {
    if (hits.length === 0) return hits;

    const paths = [
      ...new Set(
        hits
          .map((h) => h.filePath)
          .filter((p): p is string => !!p && p.length > 0),
      ),
    ];

    const descriptions = await this.lookupDescriptions(repositoryId, paths);

    return hits.map((hit) => {
      if (!hit.filePath) return hit;
      const description = descriptions.get(hit.filePath);
      if (!description) return hit;
      return { ...hit, content: description };
    });
  }

  private async lookupDescriptions(
    repositoryId: string,
    filePaths: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (filePaths.length === 0) return map;

    const collectionName = `repo-${repositoryId}`;

    // Batch by querying with a dummy embedding + filePath where filter.
    // One query per unique path keeps results precise for enrichment.
    let embedding: number[];
    try {
      embedding = await this.gemini.embedString('file description lookup');
    } catch (error) {
      this.logger.warn(
        `Hit enricher embedding failed: ${(error as Error).message}`,
      );
      return map;
    }

    await Promise.all(
      filePaths.slice(0, 20).map(async (filePath) => {
        try {
          const result = await this.chroma.queryCollection(
            collectionName,
            embedding,
            1,
            { filePath },
          );
          const doc = result.documents?.[0]?.[0];
          if (doc) {
            map.set(filePath, doc);
          }
        } catch {
          // Missing collection or no match — leave graph summary.
        }
      }),
    );

    return map;
  }
}
