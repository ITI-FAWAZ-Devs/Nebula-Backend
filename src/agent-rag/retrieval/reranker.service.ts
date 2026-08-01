import { Injectable } from '@nestjs/common';
import { GeminiService } from '../../gemini/gemini.service';
import { RetrievalHit } from '../dto/retrieval-hit.dto';

@Injectable()
export class RerankerService {
  constructor(private readonly gemini: GeminiService) {}

  async rerank(query: string, hits: RetrievalHit[]): Promise<RetrievalHit[]> {
    if (hits.length === 0) return hits;
    if (hits.length === 1) return hits;

    const scores = await this.gemini.scoreRelevance(
      query,
      hits.map((h) => ({ id: h.nodeId, content: h.content })),
    );
    const byId = new Map(scores.map((s) => [s.id, s.score]));

    return hits
      .map((h) => ({
        ...h,
        score: byId.get(h.nodeId) ?? h.score,
      }))
      .sort((a, b) => b.score - a.score);
  }
}
