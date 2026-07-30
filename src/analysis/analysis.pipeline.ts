import { Injectable, Logger } from '@nestjs/common';
import {
  AnalysisJobStatus,
  RepositoryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceContext } from '../workspace/interfaces/workspace-context.interface';
import { GitService } from '../git/git.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { GraphifyService } from '../graphify/graphify.service';
import { GraphNormalizerService } from '../graph/graph-normalizer.service';
import { GraphBuilderService } from '../graph/graph-builder.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { GraphLinkService } from './graph-link.service';

@Injectable()
export class AnalysisPipeline {
  private readonly logger = new Logger(AnalysisPipeline.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly gitService: GitService,
    private readonly discoveryService: DiscoveryService,
    private readonly graphifyService: GraphifyService,
    private readonly normalizer: GraphNormalizerService,
    private readonly graphBuilder: GraphBuilderService,
    private readonly neo4j: Neo4jService,
    private readonly graphLink: GraphLinkService,
  ) {}

  async execute(
    repositoryId: string,
    analysisJobId: string,
    userId: string,
  ): Promise<void> {
    let workspace: WorkspaceContext | null = null;

    try {
      await this.updateJob(analysisJobId, {
        status: AnalysisJobStatus.RUNNING,
        stage: 'starting',
        startedAt: new Date(),
      });

      const repository = await this.prisma.repository.findUniqueOrThrow({
        where: { id: repositoryId },
      });

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

      // 3. Repository discovery
      await this.setStage(
        analysisJobId,
        repositoryId,
        'discovery',
        RepositoryStatus.INDEXING,
      );
      const project = await this.discoveryService.scan(
        cloneResult.localPath,
      );

      // 4. Graphify analysis
      await this.setStage(analysisJobId, repositoryId, 'graphify', null);
      const graphifyOutput = await this.graphifyService.analyze(
        project,
        workspace,
      );

      // 5. Normalize
      await this.setStage(analysisJobId, repositoryId, 'normalize', null);
      const normalized = this.normalizer.normalize(graphifyOutput);

      // 6. Build knowledge graph
      await this.setStage(analysisJobId, repositoryId, 'build_graph', null);
      const graph = this.graphBuilder.build(normalized, repositoryId);

      // 7. Save to Neo4j
      await this.setStage(analysisJobId, repositoryId, 'save_neo4j', null);
      await this.neo4j.saveGraph(graph);

      // 8. Link Chroma embeddings to Neo4j graph nodes
      await this.setStage(analysisJobId, repositoryId, 'link_embeddings', null);
      try {
        const collectionName = `repo-${repositoryId}`;
        await this.graphLink.linkEmbeddingsToGraphNodes(
          repositoryId,
          collectionName,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to link embeddings to graph nodes: ${(error as Error).message}`,
        );
      }

      // Mark complete
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { status: RepositoryStatus.READY },
      });
      await this.updateJob(analysisJobId, {
        status: AnalysisJobStatus.COMPLETED,
        stage: 'done',
        finishedAt: new Date(),
        error: null,
      });

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

      await this.updateJob(analysisJobId, {
        status: AnalysisJobStatus.FAILED,
        error: message,
        finishedAt: new Date(),
      }).catch(() => undefined);

      throw error;
    } finally {
      // 8. Always cleanup workspace
      if (workspace) {
        await this.workspaceService.cleanup(workspace);
      }
    }
  }

  private async setStage(
    analysisJobId: string,
    repositoryId: string,
    stage: string,
    repoStatus: RepositoryStatus | null,
  ): Promise<void> {
    await this.updateJob(analysisJobId, { stage });
    if (repoStatus) {
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { status: repoStatus },
      });
    }
  }

  private async updateJob(
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
  }
}
