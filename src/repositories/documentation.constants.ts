export const DOCUMENTATION_QUEUE = 'documentation-queue';

export interface DocumentationJobPayload {
  repositoryId: string;
  documentationJobId: string;
  userId: string;
}
