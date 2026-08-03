import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { GitService } from '../git/git.service';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';

@Injectable()
export class CodeContextLoaderService {
  private readonly logger = new Logger(CodeContextLoaderService.name);
  private readonly resolvedPaths = new Map<string, string | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gitService: GitService,
  ) {}

  async ensureClone(
    repositoryId: string,
    userId: string,
  ): Promise<string | null> {
    if (this.resolvedPaths.has(repositoryId)) {
      return this.resolvedPaths.get(repositoryId) ?? null;
    }

    const path = await this.resolveClone(repositoryId, userId);
    this.resolvedPaths.set(repositoryId, path);
    return path;
  }

  private async resolveClone(
    repositoryId: string,
    userId: string,
  ): Promise<string | null> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        cloneUrl: true,
        defaultBranch: true,
        localPath: true,
      },
    });

    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    if (repository.localPath) {
      try {
        await fs.access(repository.localPath);
        this.logger.log(
          `Reusing local clone for ${repositoryId} at ${repository.localPath}`,
        );
        return repository.localPath;
      } catch {
        this.logger.warn(
          `Stored localPath for ${repositoryId} is missing, re-cloning`,
        );
      }
    }

    if (!repository.cloneUrl) {
      this.logger.warn(
        `Repository ${repositoryId} has no cloneUrl, skipping code enrichment`,
      );
      return null;
    }

    const workspaceRoot = this.configService.get<string>(
      'workspace.root',
      '/workspace',
    );
    const destPath = path.join(workspaceRoot, `draft-${repositoryId}`);

    try {
      const result = await this.gitService.clone({
        userId,
        repositoryId,
        cloneUrl: repository.cloneUrl,
        destPath,
        branch: repository.defaultBranch || 'main',
      });

      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { localPath: result.localPath },
      });

      return result.localPath;
    } catch (error) {
      this.logger.error(
        `Failed to clone ${repositoryId} for drafting: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async enrich(
    context: HybridRetrievalContext,
    rootPath: string | null,
  ): Promise<HybridRetrievalContext> {
    if (!rootPath) {
      return context;
    }

    const maxFiles = this.configService.get<number>(
      'drafting.codeContextMaxFiles',
      12,
    );
    const maxCharsPerFile = this.configService.get<number>(
      'drafting.codeContextMaxCharsPerFile',
      4000,
    );
    const maxTotalChars = this.configService.get<number>(
      'drafting.codeContextMaxTotalChars',
      32000,
    );

    const candidates = [...context.files]
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, maxFiles);

    let budget = maxTotalChars;

    for (const file of candidates) {
      file.codeContent = undefined;
      file.codeLoadError = undefined;

      const absolutePath = path.join(rootPath, file.filePath);
      let raw: string;
      try {
        raw = await fs.readFile(absolutePath, 'utf8');
      } catch (error) {
        file.codeLoadError = (error as Error).message;
        this.logger.warn(
          `Could not read ${file.filePath} for code context: ${file.codeLoadError}`,
        );
        continue;
      }

      if (raw.length > budget) {
        break;
      }

      file.codeContent = raw.slice(0, maxCharsPerFile);
      budget -= file.codeContent.length;
    }

    return context;
  }
}
