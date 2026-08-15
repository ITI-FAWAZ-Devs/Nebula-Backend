import { DocumentationJobStatus } from '@prisma/client';

export interface AdminDocumentationJobOwnerUserDto {
  id: string;
  email: string | null;
  fullName: string | null;
  avatar: string | null;
}

export interface AdminDocumentationJobRepositoryDto {
  id: string;
  name: string;
  owner: string;
  githubUrl: string;
  isPrivate: boolean;
}

export class AdminDocumentationJobSummaryDto {
  id: string;
  status: DocumentationJobStatus;
  stage: string | null;
  progress: number | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  repository: AdminDocumentationJobRepositoryDto;
  user: AdminDocumentationJobOwnerUserDto;
}
