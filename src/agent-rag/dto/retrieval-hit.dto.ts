import { EntityType } from '../../graph/interfaces/entity.interface';

export type RetrievalSource = 'vector' | 'graph';

export type RetrievalHitType = EntityType | 'Chunk';

/**
 * Shared retrieval response shape for vector + graph tools.
 * Everything downstream (ranking, context building, citations) depends on this.
 */
export interface RetrievalHit {
  nodeId: string;
  type: RetrievalHitType;
  filePath: string | null;
  lineRange: string | null;
  content: string;
  score: number;
  source: RetrievalSource;
}

export interface AgentCitation {
  filePath: string;
  lineRange: string | null;
  nodeId: string;
}
