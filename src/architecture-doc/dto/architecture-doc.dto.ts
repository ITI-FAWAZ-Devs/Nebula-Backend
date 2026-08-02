import { IsOptional, IsString } from 'class-validator';
import { DocStatus } from '@prisma/client';

export class CreateArchitectureDocDto {
  @IsOptional()
  @IsString()
  commitSha?: string;
}

export interface ArchitectureDocTriggerResponse {
  docId: string;
  jobId: string;
  version: number;
  status: DocStatus;
}

export type ArchitectureDocRegenerateResponse =
  | {
      needsRegeneration: true;
      docId: string;
      jobId: string;
      version: number;
      status: DocStatus;
    }
  | {
      needsRegeneration: false;
      currentCommitSha: string;
      latestVersion: number;
    };

export interface ArchitectureDocJobResponse {
  jobId: string;
  docId: string;
  status: DocStatus;
  errorMessage: string | null;
}

export interface ArchitectureDocVersionSummary {
  docId: string;
  version: number;
  status: DocStatus;
  generatedAt: Date | null;
  verificationScore: number | null;
}

export interface ArchitectureDocSectionResponse {
  key: string;
  title: string;
  order: number;
  contentMd: string;
  sourceFiles: string[];
  diagramMermaid: string | null;
  verified: boolean;
  verificationNotes: string | null;
}

export interface ArchitectureDocResponse {
  docId: string;
  version: number;
  status: DocStatus;
  commitSha: string | null;
  generatedAt: Date | null;
  verificationScore: number | null;
  sections: ArchitectureDocSectionResponse[];
}
