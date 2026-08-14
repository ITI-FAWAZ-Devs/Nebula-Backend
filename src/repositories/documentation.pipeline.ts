import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentationJobStatus, RepositoryStatus } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceContext } from '../workspace/interfaces/workspace-context.interface';
import { GitService } from '../git/git.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import {
  collectionNameFor,
  embeddingSpaceMetadata,
} from '../ai-provider/embedding-space.util';
import { ChromaService } from '../chroma/chroma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  fromPrismaJson,
  markStage,
  hasStage,
  toPrismaJson,
  ensureCheckpointDir,
  removeCheckpointDir,
  getWorkspaceRoot,
  PipelineCheckpoint,
} from '../common/pipeline-checkpoint';

@Injectable()
export class DocumentationPipeline {
  private readonly logger = new Logger(DocumentationPipeline.name);

  private readonly describeConcurrency: number;
  private readonly describeDelayMs: number;
  private readonly workspaceRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    private readonly workspaceService: WorkspaceService,
    private readonly gitService: GitService,
    private readonly discoveryService: DiscoveryService,
    private readonly aiProviderService: AiProviderService,
    private readonly chromaService: ChromaService,
    private readonly subscriptionService: SubscriptionService,
    configService: ConfigService,
  ) {
    this.describeConcurrency =
      configService.get<number>('documentation.describeConcurrency') ?? 4;
    this.describeDelayMs =
      configService.get<number>('documentation.describeDelayMs') ?? 0;
    this.workspaceRoot = getWorkspaceRoot(configService);
  }

  async execute(
    repositoryId: string,
    jobId: string,
    userId: string,
  ): Promise<void> {
    let workspace: WorkspaceContext | null = null;

    const job = await this.prisma.documentationJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    let checkpoint = fromPrismaJson(job.checkpoint);

    try {
      await this.updateJob(repositoryId, jobId, {
        status: DocumentationJobStatus.RUNNING,
        stage: 'starting',
        startedAt: job.startedAt ?? new Date(),
        error: null,
      });

      const tierConfig = await this.subscriptionService.checkAndIncrementQuota(
        userId,
        'DOCUMENTATION_INDEXING',
        repositoryId,
      );

      const repository = await this.prisma.repository.findUniqueOrThrow({
        where: { id: repositoryId },
      });

      const cpDir = await ensureCheckpointDir(this.workspaceRoot, jobId);
      const descriptionsPath = path.join(cpDir, 'descriptions.json');

      // ── Stage: clone (skip if localPath accessible) ─────────────────────────
      let localPath = repository.localPath;
      let commitHash = repository.lastIndexedCommit;
      let isPathAccessible = false;

      if (localPath) {
        try {
          await fs.access(localPath);
          isPathAccessible = true;
        } catch {
          isPathAccessible = false;
        }
      }

      if (isPathAccessible && localPath) {
        this.logger.log(`[${jobId}] Reusing existing local path ${localPath}`);
        try {
          const git = simpleGit(localPath);
          commitHash = (await git.revparse(['HEAD'])).trim();
        } catch (err) {
          this.logger.warn(
            `[${jobId}] Failed to revparse HEAD in ${localPath}: ${(err as Error).message}`,
          );
        }
      } else {
        await this.setStage(jobId, repositoryId, 'workspace', null);
        workspace = await this.workspaceService.create(jobId);

        await this.setStage(
          jobId,
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

        localPath = cloneResult.localPath;
        commitHash = cloneResult.commitHash;

        await this.prisma.repository.update({
          where: { id: repositoryId },
          data: {
            lastIndexedCommit: commitHash,
            localPath,
          },
        });
        checkpoint = markStage(checkpoint, 'clone', { localPath });
        await this.saveCheckpoint(jobId, checkpoint);
      }

      // ── Stage: discovery ────────────────────────────────────────────────────
      await this.setStage(
        jobId,
        repositoryId,
        'discovery',
        RepositoryStatus.INDEXING,
      );
      await this.discoveryService.scan(localPath);

      const files = await this.getFilesRecursively(localPath);
      this.logger.log(`[${jobId}] Discovered ${files.length} code files`);

      if (files.length === 0) {
        throw new Error('No indexable code files found in repository');
      }

      checkpoint = markStage(checkpoint, 'discovery');
      await this.saveCheckpoint(jobId, checkpoint);

      // ── Stage: describe_files (resume per-file) ──────────────────────────────
      await this.setStage(jobId, repositoryId, 'describe_files', null);

      // Load previously completed descriptions
      const savedDescriptions = await this.loadDescriptions(descriptionsPath);
      let completedCount = Object.keys(savedDescriptions).length;

      const describeOne = async (file: string): Promise<void> => {
        if (savedDescriptions[file] !== undefined) {
          // Already described in a prior run — count progress but skip API call
          completedCount += 1;
          await this.updateJob(repositoryId, jobId, {
            stage: 'describe_files',
            progress: Math.round((completedCount / files.length) * 100),
          });
          return;
        }

        try {
          const fullPath = path.join(localPath, file);
          const content = await fs.readFile(fullPath, 'utf-8');
          const description = (
            await this.aiProviderService.describeFile(file, content, {
              overrideProvider: tierConfig.llmProvider,
              overrideModel: tierConfig.llmModel,
            })
          ).text;
          savedDescriptions[file] = description;

          // Persist after each success so a crash doesn't lose this file
          await this.persistDescriptions(descriptionsPath, savedDescriptions);
        } catch (err) {
          this.logger.error(
            `[${jobId}] Error describing file ${file}: ${(err as Error).message}`,
          );
        }

        completedCount += 1;
        await this.updateJob(repositoryId, jobId, {
          stage: 'describe_files',
          progress: Math.round((completedCount / files.length) * 100),
        });

        if (this.describeDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.describeDelayMs),
          );
        }
      };

      // Process only files not yet described, with bounded concurrency
      const remaining = files.filter((f) => savedDescriptions[f] === undefined);
      this.logger.log(
        `[${jobId}] Describing ${remaining.length} files (${files.length - remaining.length} already done)`,
      );

      // Re-emit progress for already-described files before starting new ones
      if (completedCount > 0) {
        await this.updateJob(repositoryId, jobId, {
          stage: 'describe_files',
          progress: Math.round((completedCount / files.length) * 100),
        });
      }

      let nextIndex = 0;
      const workers = Array.from(
        {
          length: Math.min(
            this.describeConcurrency,
            Math.max(remaining.length, 1),
          ),
        },
        async () => {
          while (nextIndex < remaining.length) {
            const file = remaining[nextIndex];
            nextIndex += 1;
            await describeOne(file);
          }
        },
      );
      await Promise.all(workers);

      const validDescriptions = files
        .filter((f) => savedDescriptions[f] !== undefined)
        .map((f) => ({ file: f, description: savedDescriptions[f] }));

      if (validDescriptions.length === 0) {
        throw new Error(
          'Failed to generate description for any file in the repository',
        );
      }

      checkpoint = markStage(checkpoint, 'describe_files');
      await this.saveCheckpoint(jobId, checkpoint);

      // ── Stage: embed_descriptions ────────────────────────────────────────────
      if (!hasStage(checkpoint, 'embed_descriptions')) {
        await this.setStage(jobId, repositoryId, 'embed_descriptions', null);
        const textToEmbed = validDescriptions.map((d) => d.description);
        const embedResult = await this.aiProviderService.embedMany(
          textToEmbed,
          'search_document',
          {
            overrideProvider: tierConfig.embeddingProvider,
            overrideModel: tierConfig.embeddingModel,
          },
        );

        const embeddingMeta = embeddingSpaceMetadata(embedResult);
        const chunks = validDescriptions.map((d, index) => ({
          id: `${repositoryId}:${d.file}`,
          document: d.description,
          metadata: {
            repositoryId,
            userId: repository.userId,
            filePath: d.file,
            language: this.getLanguageFromExtension(d.file),
            commitHash: commitHash || 'unknown',
            ...embeddingMeta,
          },
          embedding: embedResult.embeddings[index],
        }));

        // ── Stage: save_chroma ─────────────────────────────────────────────────
        await this.setStage(jobId, repositoryId, 'save_chroma', null);
        const collectionName = collectionNameFor(repositoryId, embedResult);
        await this.chromaService.deleteCollection(collectionName);
        await this.chromaService.upsertChunks(collectionName, chunks);

        checkpoint = markStage(checkpoint, 'embed_descriptions');
        checkpoint = markStage(checkpoint, 'save_chroma');
        await this.saveCheckpoint(jobId, checkpoint);
      } else {
        this.logger.log(
          `[${jobId}] Skipping embed_descriptions + save_chroma — already completed`,
        );
      }

      // ── Mark complete ────────────────────────────────────────────────────────
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: {
          status: RepositoryStatus.READY,
          lastDocumentedAt: new Date(),
          documentedCommit: commitHash,
        },
      });

      await this.updateJob(repositoryId, jobId, {
        status: DocumentationJobStatus.COMPLETED,
        stage: 'done',
        progress: 100,
        finishedAt: new Date(),
        error: null,
      });

      // Remove durable checkpoint artifacts on clean success
      await removeCheckpointDir(this.workspaceRoot, jobId).catch(
        () => undefined,
      );

      this.logger.log(
        `[${jobId}] Documentation indexing completed for repository ${repositoryId}`,
      );
    } catch (error) {
      const message =
        (error as Error).message || 'Unknown documentation pipeline error';
      this.logger.error(
        `[${jobId}] Documentation pipeline failed for repository ${repositoryId}: ${message}`,
      );

      await this.prisma.repository
        .update({
          where: { id: repositoryId },
          data: { status: RepositoryStatus.FAILED },
        })
        .catch(() => undefined);

      await this.updateJob(repositoryId, jobId, {
        status: DocumentationJobStatus.FAILED,
        error: message,
        finishedAt: new Date(),
      }).catch(() => undefined);

      throw error;
    } finally {
      if (workspace) {
        await this.workspaceService
          .cleanup(workspace)
          .catch((err) =>
            this.logger.error(
              `[${jobId}] Failed to cleanup workspace: ${(err as Error).message}`,
            ),
          );
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async loadDescriptions(
    descriptionsPath: string,
  ): Promise<Record<string, string>> {
    try {
      const raw = await fs.readFile(descriptionsPath, 'utf-8');
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async persistDescriptions(
    descriptionsPath: string,
    descriptions: Record<string, string>,
  ): Promise<void> {
    await fs.writeFile(descriptionsPath, JSON.stringify(descriptions), 'utf-8');
  }

  private async setStage(
    jobId: string,
    repositoryId: string,
    stage: string,
    repoStatus: RepositoryStatus | null,
  ): Promise<void> {
    await this.updateJob(repositoryId, jobId, { stage });
    if (repoStatus) {
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { status: repoStatus },
      });
    }
  }

  private async saveCheckpoint(
    jobId: string,
    checkpoint: PipelineCheckpoint,
  ): Promise<void> {
    await this.prisma.documentationJob.update({
      where: { id: jobId },
      data: { checkpoint: toPrismaJson(checkpoint) },
    });
  }

  private async updateJob(
    repositoryId: string,
    jobId: string,
    data: {
      status?: DocumentationJobStatus;
      stage?: string | null;
      progress?: number | null;
      error?: string | null;
      startedAt?: Date;
      finishedAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.documentationJob.update({
      where: { id: jobId },
      data,
    });

    const fresh = await this.prisma.documentationJob.findUnique({
      where: { id: jobId },
    });
    if (fresh) {
      this.progress.publishDocumentation(repositoryId, fresh);
    }
  }

  private async getFilesRecursively(
    dir: string,
    baseDir = dir,
  ): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const resPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, resPath);

      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'coverage' ||
        entry.name === 'package-lock.json' ||
        entry.name === 'pnpm-lock.yaml' ||
        entry.name === 'yarn.lock'
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await this.getFilesRecursively(resPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const binaryExtensions = new Set([
          '.png',
          '.jpg',
          '.jpeg',
          '.gif',
          '.ico',
          '.svg',
          '.webp',
          '.bmp',
          '.tiff',
          '.pdf',
          '.zip',
          '.tar',
          '.gz',
          '.7z',
          '.rar',
          '.mp3',
          '.wav',
          '.mp4',
          '.avi',
          '.mov',
          '.mkv',
          '.woff',
          '.woff2',
          '.ttf',
          '.eot',
          '.otf',
          '.db',
          '.sqlite',
          '.sqlite3',
          '.exe',
          '.dll',
          '.so',
          '.dylib',
          '.dmg',
          '.jar',
          '.class',
          '.pyc',
          '.o',
          '.obj',
        ]);

        if (binaryExtensions.has(ext)) continue;

        try {
          const stat = await fs.stat(resPath);
          if (stat.size > 100 * 1024) continue;
        } catch {
          continue;
        }

        files.push(relPath);
      }
    }

    return files;
  }

  private getLanguageFromExtension(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'TypeScript';
      case '.js':
      case '.jsx':
        return 'JavaScript';
      case '.py':
        return 'Python';
      case '.go':
        return 'Go';
      case '.java':
        return 'Java';
      case '.cpp':
      case '.cc':
      case '.h':
        return 'C++';
      case '.c':
        return 'C';
      case '.cs':
        return 'C#';
      case '.rb':
        return 'Ruby';
      case '.php':
        return 'PHP';
      case '.sh':
        return 'Shell';
      case '.yml':
      case '.yaml':
        return 'YAML';
      case '.json':
        return 'JSON';
      case '.md':
        return 'Markdown';
      case '.html':
        return 'HTML';
      case '.css':
        return 'CSS';
      default:
        return 'Unknown';
    }
  }
}
