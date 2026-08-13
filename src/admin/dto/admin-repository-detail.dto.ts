import {
  DocStatus,
  DocumentationJobStatus,
  RepositoryStatus,
} from '@prisma/client';
import {
  AdminDocumentationStatus,
  AdminRepositoryOwnerUserDto,
} from './admin-repository-summary.dto';

export interface AdminRepositoryOrganizationDto {
  id: string;
  name: string;
}

export interface AdminRepositoryDocumentationJobDto {
  id: string;
  status: DocumentationJobStatus;
  stage: string | null;
  progress: number | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface AdminRepositoryGeneratedDocVersionDto {
  id: string;
  version: number;
  status: DocStatus;
  commitSha: string | null;
  generatedAt: Date | null;
  verificationScore: number | null;
  triggeredByUserId: string | null;
  createdAt: Date;
}

export class AdminRepositoryDetailDto {
  id: string;
  name: string;
  githubUrl: string;
  githubRepoId: string | null;
  owner: string;
  defaultBranch: string;
  isPrivate: boolean;
  user: AdminRepositoryOwnerUserDto;
  organization: AdminRepositoryOrganizationDto | null;
  repositoryStatus: RepositoryStatus;
  documentationStatus: AdminDocumentationStatus;
  importDate: Date;
  lastDocumentationGeneration: Date | null;
  lastIndexedCommit: string | null;
  documentedCommit: string | null;
  latestDocumentationJob: AdminRepositoryDocumentationJobDto | null;
  latestGeneratedDoc: AdminRepositoryGeneratedDocVersionDto | null;
  generatedDocVersions: AdminRepositoryGeneratedDocVersionDto[];
  documentationJobsCount: number;
  analysisJobsCount: number;
  usageLogsCount: number;
  qaRequestsCount: number;
  createdAt: Date;
  updatedAt: Date;
}
