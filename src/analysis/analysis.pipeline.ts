import { Injectable, Logger } from '@nestjs/common';
import { AnalysisJobStatus, RepositoryStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceContext } from '../workspace/interfaces/workspace-context.interface';
import { GitService } from '../git/git.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { GraphifyService } from '../graphify/graphify.service';
import { GraphNormalizerService } from '../graph/graph-normalizer.service';
import { GraphBuilderService } from '../graph/graph-builder.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import {
  fromPrismaJson,
  markStage,
  hasStage,
  emptyCheckpoint,
  toPrismaJson,
  ensureCheckpointDir,
  removeCheckpointDir,
  getWorkspaceRoot,
  PipelineCheckpoint,
} from '../common/pipeline-checkpoint';

@Injectable()
export class AnalysisPipeline {
  private readonly logger = new Logger(AnalysisPipeline.name);
  private readonly workspaceRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    private readonly workspaceService: WorkspaceService,
    private readonly gitService: GitService,
    private readonly discoveryService: DiscoveryService,
    private readonly graphifyService: GraphifyService,
    private readonly normalizer: GraphNormalizerService,
    private readonly graphBuilder: GraphBuilderService,
    private readonly neo4j: Neo4jService,
    configService: ConfigService,
  ) {
    this.workspaceRoot = getWorkspaceRoot(configService);
  }

  async execute(
    repositoryId: string,
    analysisJobId: string,
    userId: string,
  ): Promise<void> {
    let workspace: WorkspaceContext | null = null;

    const job = await this.prisma.analysisJob.findUniqueOrThrow({
      where: { id: analysisJobId },
    });
    let checkpoint = fromPrismaJson(job.checkpoint);

    try {
      await this.updateJob(repositoryId, analysisJobId, {
        status: AnalysisJobStatus.RUNNING,
        stage: 'starting',
        startedAt: job.startedAt ?? new Date(),
        error: null,
      });

      const repository = await this.prisma.repository.findUniqueOrThrow({
        where: { id: repositoryId },
      });

      const cpDir = await ensureCheckpointDir(
        this.workspaceRoot,
        analysisJobId,
      );
      const checkpointGraphPath = path.join(cpDir, 'graph.json');

      // ── Stage: workspace / clone ────────────────────────────────────────────
      let localPath = repository.localPath;
      let isPathAccessible = false;
      if (localPath) {
        try {
          await fs.access(localPath);
          isPathAccessible = true;
        } catch {
          isPathAccessible = false;
        }
      }

      if (!hasStage(checkpoint, 'clone') || !isPathAccessible) {
        // 1. Create workspace
        await this.setStage(analysisJobId, repositoryId, 'workspace', null);
        workspace = await this.workspaceService.create(analysisJobId);

        // 2. Clone repository
        await this.setStage(
          analysisJobId,
          repositoryId,
          'clone',
          RepositoryStatus.CLONING,
        );
        const cloneResult = await this.gitService.clone({
          userId,
          repositoryId,
          cloneUrl: repository.cloneUrl,
          destPath: workspace.repositoryPath,
          branch: repository.defaultBranch,
        });

        await this.prisma.repository.update({
          where: { id: repositoryId },
          data: {
            lastIndexedCommit: cloneResult.commitHash,
            localPath: cloneResult.localPath,
          },
        });
        localPath = cloneResult.localPath;
        checkpoint = markStage(checkpoint, 'clone', { localPath });
        await this.saveCheckpoint(analysisJobId, checkpoint);
      } else {
        this.logger.log(
          `[${analysisJobId}] Skipping clone — reusing localPath ${localPath}`,
        );
        localPath =
          (checkpoint.artifacts.localPath as string | undefined) ??
          localPath ??
          '';
        await this.setStage(
          analysisJobId,
          repositoryId,
          'clone',
          RepositoryStatus.CLONING,
        );
        await this.setStage(analysisJobId, repositoryId, 'clone_skipped', null);
      }

      // ── Stage: discovery ────────────────────────────────────────────────────
      await this.setStage(
        analysisJobId,
        repositoryId,
        'discovery',
        RepositoryStatus.INDEXING,
      );
      const project = await this.discoveryService.scan(localPath);
      checkpoint = markStage(checkpoint, 'discovery');
      await this.saveCheckpoint(analysisJobId, checkpoint);

      // ── Stage: graphify ─────────────────────────────────────────────────────
      let graphifyOutputPath: string;
      let graphifyOutput;

      if (
        hasStage(checkpoint, 'graphify') &&
        checkpoint.artifacts.graphifyPath
      ) {
        const cachedPath = checkpoint.artifacts.graphifyPath as string;
        let fileExists = false;
        try {
          await fs.access(cachedPath);
          fileExists = true;
        } catch {
          fileExists = false;
        }

        if (fileExists) {
          this.logger.log(
            `[${analysisJobId}] Skipping graphify — loading cached ${cachedPath}`,
          );
          graphifyOutputPath = cachedPath;
          const raw = JSON.parse(await fs.readFile(cachedPath, 'utf-8'));
          graphifyOutput = raw;
          await this.setStage(analysisJobId, repositoryId, 'graphify', null);
        } else {
          graphifyOutput = await this.runGraphify(
            analysisJobId,
            repositoryId,
            project,
            workspace,
            localPath,
            checkpointGraphPath,
          );
          graphifyOutputPath = checkpointGraphPath;
          checkpoint = markStage(checkpoint, 'graphify', {
            graphifyPath: graphifyOutputPath,
          });
          await this.saveCheckpoint(analysisJobId, checkpoint);
        }
      } else {
        graphifyOutput = await this.runGraphify(
          analysisJobId,
          repositoryId,
          project,
          workspace,
          localPath,
          checkpointGraphPath,
        );
        graphifyOutputPath = checkpointGraphPath;
        checkpoint = markStage(checkpoint, 'graphify', {
          graphifyPath: graphifyOutputPath,
        });
        await this.saveCheckpoint(analysisJobId, checkpoint);
      }

      // ── Stage: normalize ────────────────────────────────────────────────────
      await this.setStage(analysisJobId, repositoryId, 'normalize', null);
      const normalized = this.normalizer.normalize(graphifyOutput);
      checkpoint = markStage(checkpoint, 'normalize');
      await this.saveCheckpoint(analysisJobId, checkpoint);

      // ── Stage: build_graph ──────────────────────────────────────────────────
      await this.setStage(analysisJobId, repositoryId, 'build_graph', null);
      const graph = this.graphBuilder.build(normalized, repositoryId);
      checkpoint = markStage(checkpoint, 'build_graph');
      await this.saveCheckpoint(analysisJobId, checkpoint);

      // ── Stage: save_neo4j ───────────────────────────────────────────────────
      if (!hasStage(checkpoint, 'save_neo4j')) {
        await this.setStage(analysisJobId, repositoryId, 'save_neo4j', null);
        await this.neo4j.saveGraph(graph);
        checkpoint = markStage(checkpoint, 'save_neo4j');
        await this.saveCheckpoint(analysisJobId, checkpoint);
      } else {
        this.logger.log(
          `[${analysisJobId}] Skipping save_neo4j — already persisted`,
        );
      }

      // ── Mark complete ───────────────────────────────────────────────────────
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { status: RepositoryStatus.READY },
      });
      await this.updateJob(repositoryId, analysisJobId, {
        status: AnalysisJobStatus.COMPLETED,
        stage: 'done',
        finishedAt: new Date(),
        error: null,
      });

      // Remove durable checkpoint artifacts on clean success
      await removeCheckpointDir(this.workspaceRoot, analysisJobId).catch(
        () => undefined,
      );

      this.logger.log(
        `Analysis completed for repository ${repositoryId} (job ${analysisJobId})`,
      );
    } catch (error) {
      const message = (error as Error).message || 'Unknown analysis error';
      this.logger.error(
        `Analysis failed for repository ${repositoryId}: ${message}`,
      );

      await this.prisma.repository
        .update({
          where: { id: repositoryId },
          data: { status: RepositoryStatus.FAILED },
        })
        .catch(() => undefined);

      await this.updateJob(repositoryId, analysisJobId, {
        status: AnalysisJobStatus.FAILED,
        error: message,
        finishedAt: new Date(),
      }).catch(() => undefined);

      throw error;
    } finally {
      // Only cleanup ephemeral workspace dirs; checkpoints are kept for retry
      if (workspace) {
        await this.workspaceService.cleanup(workspace);
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async runGraphify(
    analysisJobId: string,
    repositoryId: string,
    project: import('../discovery/interfaces/project-metadata.interface').ProjectMetadata,
    workspace: WorkspaceContext | null,
    localPath: string,
    checkpointGraphPath: string,
  ) {
    await this.setStage(analysisJobId, repositoryId, 'graphify', null);

    // Build a minimal workspace context if we're on a resume with no live workspace
    let ws = workspace;
    if (!ws) {
      ws = await this.workspaceService.create(analysisJobId);
    }

    const result = await this.graphifyService.analyze(project, ws);

    // Persist graphify JSON to checkpoint dir so it survives a crash
    await fs
      .copyFile(result.outputPath ?? checkpointGraphPath, checkpointGraphPath)
      .catch(() => {
        // outputPath may not exist if graphify produced an empty fallback; write empty
        return fs.writeFile(
          checkpointGraphPath,
          JSON.stringify({ nodes: result.nodes, edges: result.edges }),
          'utf-8',
        );
      });

    return result;
  }

  private async setStage(
    analysisJobId: string,
    repositoryId: string,
    stage: string,
    repoStatus: RepositoryStatus | null,
  ): Promise<void> {
    await this.updateJob(repositoryId, analysisJobId, { stage });
    if (repoStatus) {
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { status: repoStatus },
      });
    }
  }

  private async saveCheckpoint(
    analysisJobId: string,
    checkpoint: PipelineCheckpoint,
  ): Promise<void> {
    await this.prisma.analysisJob.update({
      where: { id: analysisJobId },
      data: { checkpoint: toPrismaJson(checkpoint) },
    });
  }

  private async updateJob(
    repositoryId: string,
    analysisJobId: string,
    data: {
      status?: AnalysisJobStatus;
      stage?: string | null;
      error?: string | null;
      startedAt?: Date;
      finishedAt?: Date;
      queueJobId?: string;
    },
  ): Promise<void> {
    await this.prisma.analysisJob.update({
      where: { id: analysisJobId },
      data,
    });

    const fresh = await this.prisma.analysisJob.findUnique({
      where: { id: analysisJobId },
    });
    if (fresh) {
      this.progress.publishAnalysis(repositoryId, fresh);
    }
  }
}
