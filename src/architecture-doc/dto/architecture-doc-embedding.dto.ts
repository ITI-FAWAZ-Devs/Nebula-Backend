export interface ArchitectureDocEmbeddingSection {
  key: string;
  title: string;
  contentMd: string;
  sourceFiles: string[];
}

export interface ArchitectureDocEmbeddingPayload {
  docId: string;
  version: number;
  commitSha: string | null;
  sections: ArchitectureDocEmbeddingSection[];
  generatedAt?: string | Date;
}
