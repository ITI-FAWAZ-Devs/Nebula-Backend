export interface HybridRetrievalQuery {
  topic?: string;
  filePaths?: string[];
}

export interface HybridRetrievalOptions {
  semanticLimit?: number;
  maxHops?: number;
  maxFiles?: number;
}

export const HYBRID_RETRIEVAL_DEFAULTS = {
  semanticLimit: 10,
  maxHops: 1,
  maxFiles: 25,
} as const;

export const HYBRID_RETRIEVAL_BOUNDS = {
  semanticLimit: { min: 1, max: 20 },
  maxHops: { min: 1, max: 2 },
  maxFiles: { min: 1, max: 25 },
} as const;

export interface RetrievedFile {
  filePath: string;
  description?: string;
  semanticDistance?: number;
  semanticRank?: number;
  graphHop?: number;
  evidenceSources: ('semantic' | 'graph')[];
  combinedScore: number;
  codeContent?: string;
  codeLoadError?: string;
}

export interface FileRelationship {
  fromFilePath: string;
  toFilePath: string;
  type: string;
  hopDistance: number;
  edgeId: string;
}

export interface ModuleCluster {
  name: string;
  filePaths: string[];
}

export type SourceStatusValue = 'available' | 'empty' | 'unavailable';

export interface SourceStatus {
  semantic: SourceStatusValue;
  graph: SourceStatusValue;
}

export interface HybridRetrievalContext {
  repositoryId: string;
  files: RetrievedFile[];
  relationships: FileRelationship[];
  moduleClusters: ModuleCluster[];
  missingSeedPaths: string[];
  sourceStatus: SourceStatus;
  noEvidence: boolean;
}
