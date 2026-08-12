import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

export interface PipelineCheckpoint {
  completedStages: string[];
  artifacts: Record<string, unknown>;
}

export const MAX_RESUME_COUNT = 5;

export function emptyCheckpoint(): PipelineCheckpoint {
  return { completedStages: [], artifacts: {} };
}

export function toPrismaJson(
  checkpoint: PipelineCheckpoint,
): Prisma.InputJsonValue {
  return checkpoint as unknown as Prisma.InputJsonValue;
}

export function hasStage(
  checkpoint: PipelineCheckpoint,
  stage: string,
): boolean {
  return checkpoint.completedStages.includes(stage);
}

export function markStage(
  checkpoint: PipelineCheckpoint,
  stage: string,
  artifacts?: Record<string, unknown>,
): PipelineCheckpoint {
  const stages = checkpoint.completedStages.includes(stage)
    ? checkpoint.completedStages
    : [...checkpoint.completedStages, stage];

  return {
    completedStages: stages,
    artifacts: { ...checkpoint.artifacts, ...(artifacts ?? {}) },
  };
}

export function fromPrismaJson(raw: unknown): PipelineCheckpoint {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'completedStages' in raw &&
    'artifacts' in raw
  ) {
    const obj = raw as Record<string, unknown>;
    return {
      completedStages: Array.isArray(obj.completedStages)
        ? (obj.completedStages as string[])
        : [],
      artifacts:
        obj.artifacts && typeof obj.artifacts === 'object'
          ? (obj.artifacts as Record<string, unknown>)
          : {},
    };
  }
  return emptyCheckpoint();
}

export function checkpointDirFor(workspaceRoot: string, jobId: string): string {
  return path.join(workspaceRoot, 'checkpoints', jobId);
}

export async function ensureCheckpointDir(
  workspaceRoot: string,
  jobId: string,
): Promise<string> {
  const dir = checkpointDirFor(workspaceRoot, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeCheckpointDir(
  workspaceRoot: string,
  jobId: string,
): Promise<void> {
  const dir = checkpointDirFor(workspaceRoot, jobId);
  await fs.rm(dir, { recursive: true, force: true });
}

export function getWorkspaceRoot(configService: ConfigService): string {
  return (
    configService.get<string>('workspace.root') ??
    path.resolve(process.cwd(), 'workspace')
  );
}
