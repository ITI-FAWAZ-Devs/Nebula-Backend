import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DocStatus, RepositoryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImportRepoDto } from './dto/import-repo.dto';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Imports a repository by selecting it from GitHub and saving it to the database.
   * Supports optional organizationId for org-scoped repos.
   */
  async importRepository(userId: string, dto: ImportRepoDto) {
    // If org-scoped, verify the user has repo:import permission
    if (dto.organizationId) {
      const permissions =
        await this.organizationsService.getMemberPermissions(
          userId,
          dto.organizationId,
        );
      if (!permissions || !permissions.includes('repo:import')) {
        throw new ForbiddenException(
          'You do not have permission to import repositories in this organization',
        );
      }
    }

    // 1. Check duplicate at application level
    const existing = await this.prisma.repository.findFirst({
      where: {
        userId,
        organizationId: dto.organizationId ?? null,
        githubRepoId: dto.githubRepoId,
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
          organizationId: dto.organizationId ?? null,
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
   * If organizationId is provided, returns org-scoped repos.
   * Otherwise, returns only personal repos (organizationId IS NULL).
   */
  async listImported(userId: string, organizationId?: string) {
    if (organizationId) {
      // For org repos, verify membership
      const isMember = await this.organizationsService.isMember(
        userId,
        organizationId,
      );
      if (!isMember) {
        throw new ForbiddenException(
          'You are not a member of this organization',
        );
      }
      return this.prisma.repository.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Personal repos only
    return this.prisma.repository.findMany({
      where: { userId, organizationId: null },
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
   * Verifies access via userId (personal) or org membership.
   */
  async getImportedById(userId: string, id: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
    });

    if (!repo) {
      throw new NotFoundException('Imported repository not found');
    }

    // Check access: personal repo or org member
    if (repo.organizationId) {
      const isMember = await this.organizationsService.isMember(
        userId,
        repo.organizationId,
      );
      if (!isMember) {
        throw new ForbiddenException(
          'You do not have access to this repository',
        );
      }
    } else if (repo.userId !== userId) {
      throw new NotFoundException('Imported repository not found');
    }

    return repo;
  }

  /**
   * Removes an imported repository from the database.
   */
  async deleteImported(userId: string, id: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
    });

    if (!repo) {
      throw new NotFoundException('Imported repository not found');
    }

    // Check access: personal repo owner or org member with permissions
    if (repo.organizationId) {
      const permissions =
        await this.organizationsService.getMemberPermissions(
          userId,
          repo.organizationId,
        );
      if (!permissions) {
        throw new ForbiddenException(
          'You do not have access to this repository',
        );
      }
    } else if (repo.userId !== userId) {
      throw new NotFoundException('Imported repository not found');
    }

    await this.prisma.repository.delete({
      where: { id },
    });

    return { id };
  }
}

