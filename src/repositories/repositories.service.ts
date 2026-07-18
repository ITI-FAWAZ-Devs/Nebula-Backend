import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { RepositoryStatus } from '@prisma/client';
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
        throw new ConflictException('This repository has already been imported.');
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
