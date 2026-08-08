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

@Injectable()
export class DocumentationPipeline {
  private readonly logger = new Logger(DocumentationPipeline.name);

  private readonly describeConcurrency: number;
  private readonly describeDelayMs: number;

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
  }

  /**
   * Executes the documentation pipeline for a repository.
   */
  async execute(
    repositoryId: string,
    jobId: string,
    userId: string,
  ): Promise<void> {
    let workspace: WorkspaceContext | null = null;

    try {
      // 1. Update job to RUNNING
      await this.updateJob(repositoryId, jobId, {
        status: DocumentationJobStatus.RUNNING,
        stage: 'starting',
        startedAt: new Date(),
      });

      // Check subscription quota & resolve tier models
      const tierConfig = await this.subscriptionService.checkAndIncrementQuota(
        userId,
        'DOCUMENTATION_INDEXING',
        repositoryId,
      );

      const repository = await this.prisma.repository.findUniqueOrThrow({
        where: { id: repositoryId },
      });

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
        this.logger.log(
          `Reusing existing local path ${localPath} for repository ${repositoryId}`,
        );
        // Get the commit hash at HEAD
        try {
          const git = simpleGit(localPath);
          commitHash = (await git.revparse(['HEAD'])).trim();
        } catch (err) {
          this.logger.warn(
            `Failed to revparse HEAD in existing localPath ${localPath}: ${(err as Error).message}`,
          );
        }
      } else {
        // Clone fresh
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
            localPath: localPath,
          },
        });
      }

      // 2. Discovery
      await this.setStage(
        jobId,
        repositoryId,
        'discovery',
        RepositoryStatus.INDEXING,
      );
      // Run project discovery metadata check
      await this.discoveryService.scan(localPath);

      // Scan all code files recursively
      const files = await this.getFilesRecursively(localPath);
      this.logger.log(`Discovered ${files.length} code files to describe`);

      if (files.length === 0) {
        throw new Error('No indexable code files found in repository');
      }

      // 3. Describe files using the AI provider with bounded concurrency and
      // per-file progress so the frontend sees the pipeline moving.
      await this.setStage(jobId, repositoryId, 'describe_files', null);

      const descriptions: ({ file: string; description: string } | null)[] =
        new Array(files.length).fill(null);
      let completedCount = 0;

      const describeOne = async (index: number): Promise<void> => {
        const file = files[index];
        try {
          const fullPath = path.join(localPath, file);
          const content = await fs.readFile(fullPath, 'utf-8');
          const description = (
            await this.aiProviderService.describeFile(file, content, {
              overrideProvider: tierConfig.llmProvider,
              overrideModel: tierConfig.llmModel,
            })
          ).text;
          descriptions[index] = { file, description };
        } catch (err) {
          this.logger.error(
            `Error describing file ${file}: ${(err as Error).message}`,
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

      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(this.describeConcurrency, files.length) },
        async () => {
          while (nextIndex < files.length) {
            const index = nextIndex;
            nextIndex += 1;
            await describeOne(index);
          }
        },
      );
      await Promise.all(workers);

      const validDescriptions = descriptions.filter(
      (d): d is { file: string; description: string } => d !== null,
    );

    if (validDescriptions.length === 0) {
      throw new Error(
        'Failed to generate description for any file in the repository',
      );
    }

    // 4. Batch embed file descriptions. Indexing uses `search_document`
    // input type so the gateway embeds in the document vector space.
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

    // Map to Chroma chunks
    const chunks = validDescriptions.map((d, index) => {
      const fileLanguage = this.getLanguageFromExtension(d.file);
      return {
        id: `${repositoryId}:${d.file}`,
        document: d.description,
        metadata: {
          repositoryId,
          userId: repository.userId,
          filePath: d.file,
          language: fileLanguage,
          commitHash: commitHash || 'unknown',
          ...embeddingMeta,
        },
        embedding: embedResult.embeddings[index],
      };
    });

    // 5. Wipe-and-rebuild the Chroma collection that matches this run's
    // embedding space. Primary embeddings go to `repo-<id>`; embeddings
    // produced by a fallback provider are quarantined into a per-space
    // collection (`repo-<id>-quarantine-<provider>-<model>-<dims>d`) so the
    // vector spaces are never mixed — including between different fallback
    // providers.
    // TODO(re-embedding): once the primary provider is healthy again,
    // re-embed quarantined documents into the primary collection
    // (re-indexing is a separate task).
    await this.setStage(jobId, repositoryId, 'save_chroma', null);
    const collectionName = collectionNameFor(repositoryId, embedResult);

    // Wipe the collection if it exists
    await this.chromaService.deleteCollection(collectionName);
    // Rebuild and upsert chunks
    await this.chromaService.upsertChunks(collectionName, chunks);

    // 6. Complete Job
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

    this.logger.log(
      `Documentation indexing completed for repository ${repositoryId}`,
    );
  } catch(error) {
    const message =
      (error as Error).message || 'Unknown documentation pipeline error';
    this.logger.error(
      `Documentation pipeline failed for repository ${repositoryId}: ${message}`,
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
    // Clean up workspace if it was created
    if (workspace) {
      await this.workspaceService
        .cleanup(workspace)
        .catch((err) =>
          this.logger.error(`Failed to cleanup workspace: ${err.message}`),
        );
    }
  }
  }

  private async setStage(
    jobId: string,
    repositoryId: string,
    stage: string,
    repoStatus: RepositoryStatus | null,
  ): Promise < void> {
    await this.updateJob(repositoryId, jobId, { stage });
    if(repoStatus) {
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { status: repoStatus },
      });
    }
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
  ): Promise < void> {
    await this.prisma.documentationJob.update({
      where: { id: jobId },
      data,
    });

    const fresh = await this.prisma.documentationJob.findUnique({
      where: { id: jobId },
    });
    if(fresh) {
      this.progress.publishDocumentation(repositoryId, fresh);
    }
  }

  /**
   * Helper to scan directories recursively and get code files, filtering out binary/ignored/large files.
   */
  private async getFilesRecursively(
    dir: string,
    baseDir = dir,
  ): Promise < string[] > {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for(const entry of entries) {
      const resPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, resPath);

      // Ignore common directories and hidden files
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
        // Skip common binary files or files that are probably not code
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

        if (binaryExtensions.has(ext)) {
          continue;
        }

        // Check file size (skip files larger than 100KB to prevent overloading prompt tokens)
        try {
          const stat = await fs.stat(resPath);
          if (stat.size > 100 * 1024) {
            continue;
          }
        } catch {
          continue;
        }

        files.push(relPath);
      }
    }

    return files;
  }

  /**
   * Simple helper to map file extension to programming language.
   */
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
