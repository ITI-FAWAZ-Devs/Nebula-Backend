import { DocStatus, RepositoryStatus } from '@prisma/client';

/**
 * Documentation status of a repository. Represents the status of the most
 * recent architecture-document generation (`GeneratedDoc.status`), or
 * `NOT_GENERATED` when no documentation has ever been generated for the
 * repository.
 */
export type AdminDocumentationStatus = DocStatus | 'NOT_GENERATED';

export interface AdminRepositoryOwnerUserDto {
  id: string;
  email: string | null;
  fullName: string | null;
  avatar: string | null;
}

export class AdminRepositorySummaryDto {
  id: string;
  name: string;
  githubUrl: string;
  owner: string;
  isPrivate: boolean;
  user: AdminRepositoryOwnerUserDto;
  importDate: Date;
  repositoryStatus: RepositoryStatus;
  documentationStatus: AdminDocumentationStatus;
  lastDocumentationGeneration: Date | null;
  lastArchDocGeneratedAt: Date | null;
  qaRequestsCount: number;
  usageLogsCount: number;
}
