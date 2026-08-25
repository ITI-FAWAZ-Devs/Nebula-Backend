import { Injectable } from '@nestjs/common';
import { ChromaService } from '../../chroma/chroma.service';
import { chunkIdForFilePath } from '../../ai-provider/embedding-space.util';
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
  constructor(private readonly chroma: ChromaService) {}

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

    // Description chunks have deterministic ids (generated via chunkIdForFilePath(filePath))
    // — one chunk per file — so a single get-by-ids call replaces per-path
    // similarity queries entirely (no embedding, no extra round-trips).
    const paths = filePaths.slice(0, 20);
    const requestedIds = new Map<string, string>(
      paths.map(
        (filePath) =>
          [chunkIdForFilePath(filePath), filePath] as [string, string],
      ),
    );

    try {
      const result = await this.chroma.getByIds(collectionName, [
        ...requestedIds.keys(),
      ]);
      result.ids.forEach((id, i) => {
        const doc = result.documents[i];
        const originalPath = requestedIds.get(id);
        if (doc && originalPath) {
          map.set(originalPath, doc);
        }
      });
    } catch {
      // Missing collection or transient failure — keep graph summaries.
    }

    return map;
  }
}
