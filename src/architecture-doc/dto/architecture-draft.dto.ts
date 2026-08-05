export type VerificationVerdict = 'verified' | 'unverified' | 'removed';

export interface SectionPlan {
  key: string;
  title: string;
  purpose: string;
  retrievalTopic: string;
}

export interface DraftSection {
  key: string;
  title: string;
  contentMd: string;
  sourceFiles: string[];
  verdict: VerificationVerdict;
  verificationNotes: string | null;
  diagramMermaid?: string | null;
}

export interface ArchitectureDiagram {
  mermaidSource: string;
  modules: string[];
  verdict: VerificationVerdict;
  verificationNotes: string | null;
}

export interface ArchitectureDraft {
  repositoryId: string;
  repositoryName: string;
  sections: DraftSection[];
  diagram: ArchitectureDiagram | null;
  sectionPlan: SectionPlan[];
  sourceStatus: import('./hybrid-retrieval-context.dto').SourceStatus;
  generatedAt: Date;
}

export interface DraftRequest {
  repositoryId: string;
  userId: string;
}
