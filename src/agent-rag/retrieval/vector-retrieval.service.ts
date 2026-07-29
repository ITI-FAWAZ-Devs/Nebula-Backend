import { Injectable } from '@nestjs/common';
import { ChromaService } from '../../chroma/chroma.service';
import { GeminiService } from '../../gemini/gemini.service';
import { VECTOR_SEARCH_MAX_K } from '../agent-rag.constants';
import { RetrievalHit } from '../dto/retrieval-hit.dto';

export interface VectorSearchFilters {
  filePath?: string;
  language?: string;
}

@Injectable()
export class VectorRetrievalService {
  constructor(
    private readonly chroma: ChromaService,
    private readonly gemini: GeminiService,
  ) {}

  async search(
    repositoryId: string,
    query: string,
    k = 10,
    filters?: VectorSearchFilters,
  ): Promise<RetrievalHit[]> {
    const limit = Math.min(Math.max(1, k), VECTOR_SEARCH_MAX_K);
    const embedding = await this.gemini.embedString(query);

    const where: Record<string, string | number | boolean> = {
      repositoryId,
    };
    if (filters?.filePath) where.filePath = filters.filePath;
    if (filters?.language) where.language = filters.language;

    const collectionName = `repo-${repositoryId}`;
    const result = await this.chroma.queryCollection(
      collectionName,
      embedding,
      limit,
      where,
    );

    const ids = result.ids?.[0] || [];
    const documents = result.documents?.[0] || [];
    const metadatas = result.metadatas?.[0] || [];
    const distances = result.distances?.[0] || [];

    const hits: RetrievalHit[] = [];
    for (let i = 0; i < ids.length; i++) {
      const metadata = (metadatas[i] || {}) as Record<string, unknown>;
      const filePath =
        typeof metadata.filePath === 'string' ? metadata.filePath : null;
      const distance =
        typeof distances[i] === 'number' ? (distances[i] as number) : 1;
      const score = Math.max(0, Math.min(1, 1 / (1 + distance)));
      const content = documents[i] || '';
      if (!content) continue;

      hits.push({
        nodeId: ids[i] || `${repositoryId}:${filePath || i}`,
        type: 'Chunk',
        filePath,
        lineRange: null,
        content,
        score,
        source: 'vector',
      });
    }

    return hits;
  }
}
