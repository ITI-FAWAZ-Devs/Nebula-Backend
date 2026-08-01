export const ARCHITECTURE_DRAFT_QUEUE = 'architecture-draft';

export interface ArchitectureDraftJobPayload {
  repositoryId: string;
  documentId: string;
  userId: string;
}
