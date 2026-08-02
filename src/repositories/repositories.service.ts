import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DocStatus, RepositoryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImportRepoDto } from './dto/import-repo.dto';

@Injectable()
export class RepositoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Imports a repository by selecting it from GitHub and saving it to the database.
   */
  async importRepository(userId: string, dto: ImportRepoDto) {
    // 1. Check duplicate at application level
    const existing = await this.prisma.repository.findUnique({
      where: {
        userId_githubRepoId: {
          userId,
          githubRepoId: dto.githubRepoId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('This repository has already been imported.');
    }

    // 2. Perform DB Insertion with unique constraint violation catching
    try {
      return await this.prisma.repository.create({
        data: {
          userId,
          githubRepoId: dto.githubRepoId,
          name: dto.name,
          owner: dto.owner,
          defaultBranch: dto.defaultBranch,
          isPrivate: dto.isPrivate,
          cloneUrl: dto.cloneUrl,
          status: RepositoryStatus.IMPORTED,
        },
      });
    } catch (error: any) {
      // P2002 is Prisma's code for unique constraint violation
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'This repository has already been imported.',
        );
      }
      throw error;
    }
  }

  /**
   * Lists all repositories imported in Nebula for a specific user.
   */
  async listImported(userId: string) {
    return this.prisma.repository.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Returns, for every repository the user owns, whether a completed
   * architecture document exists along with its latest version and commit.
   */
  async getArchitectureDocStatus(userId: string) {
    const repos = await this.prisma.repository.findMany({
      where: { userId },
      select: { id: true },
    });

    const repoIds = repos.map((repo) => repo.id);
    const docs = await this.prisma.generatedDoc.findMany({
      where: {
        repositoryId: { in: repoIds },
        status: DocStatus.COMPLETED,
      },
      orderBy: { version: 'desc' },
      select: { repositoryId: true, version: true, commitSha: true },
    });

    const latestByRepo = new Map<
      string,
      { version: number; commitSha: string | null }
    >();
    for (const doc of docs) {
      if (!latestByRepo.has(doc.repositoryId)) {
        latestByRepo.set(doc.repositoryId, {
          version: doc.version,
          commitSha: doc.commitSha,
        });
      }
    }

    return repos.map((repo) => {
      const latest = latestByRepo.get(repo.id);
      return {
        repositoryId: repo.id,
        hasDoc: !!latest,
        version: latest?.version ?? null,
        commitSha: latest?.commitSha ?? null,
      };
    });
  }

  /**
   * Retrieves detail metadata for a single imported repository.
   */
  async getImportedById(userId: string, id: string) {
    const repo = await this.prisma.repository.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!repo) {
      throw new NotFoundException('Imported repository not found');
    }

    return repo;
  }

  /**
   * Removes an imported repository from the database.
   */
  async deleteImported(userId: string, id: string) {
    const existing = await this.prisma.repository.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Imported repository not found');
    }

    await this.prisma.repository.delete({
      where: { id },
    });

    return { id };
  }
}
