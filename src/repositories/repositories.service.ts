import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  DocStatus,
  RepositoryStatus,
  ConnectionProvider,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImportRepoDto } from './dto/import-repo.dto';
import { ImportFromUrlDto } from './dto/import-url.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { ConnectionsService } from '../connections/connections.service';
import { parseRepoUrl } from '../connections/utils/repo-url-parser.util';
import { Permission } from '../organizations/permissions';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationsService: OrganizationsService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  /**
   * Imports a repository by selecting it from GitHub and saving it to the database.
   * Supports optional organizationId for org-scoped repos.
   */
  async importRepository(userId: string, dto: ImportRepoDto) {
    // If org-scoped, verify the user has repo:import permission
    if (dto.organizationId) {
      const permissions = await this.organizationsService.getMemberPermissions(
        userId,
        dto.organizationId,
      );
      if (!permissions || !permissions.includes('repo.process')) {
        throw new ForbiddenException(
          'You do not have permission to import repositories in this organization',
        );
      }
    }

    // Resolve connection: explicit → org default → user default
    let connectionId = dto.connectionId;
    if (!connectionId) {
      const resolved = await this.connectionsService
        .resolveTokenForRepo({
          userId,
          orgId: dto.organizationId,
          isPrivate: dto.isPrivate,
          provider: ConnectionProvider.GITHUB,
        })
        .catch(() => null);
      // resolveTokenForRepo returns the token, but we need the connectionId — look it up
      if (dto.organizationId) {
        const orgConn = await this.connectionsService.findDefaultOrgConnection(
          dto.organizationId,
          ConnectionProvider.GITHUB,
        );
        if (orgConn) connectionId = orgConn.id;
      }
      if (!connectionId) {
        const userConn =
          await this.connectionsService.findDefaultUserConnection(
            userId,
            ConnectionProvider.GITHUB,
          );
        if (userConn) connectionId = userConn.id;
      }
    }

    const providerRepoId = dto.providerRepoId || dto.githubRepoId;
    const githubRepoId = dto.githubRepoId || dto.providerRepoId;

    // owner of the record: org-scoped repos use the org as the logical owner via organizationId;
    // userId on the repository still records who imported it for org repos too
    const recordUserId = dto.organizationId ? userId : userId;

    // 1. Check duplicate at application level
    const existing = await this.prisma.repository.findFirst({
      where: {
        organizationId: dto.organizationId ?? null,
        userId: dto.organizationId ? undefined : userId,
        OR: [
          { githubRepoId: githubRepoId ?? undefined },
          { providerRepoId: providerRepoId ?? undefined },
        ],
      },
    });

    if (existing) {
      throw new ConflictException('This repository has already been imported.');
    }

    // 2. Perform DB Insertion with unique constraint violation catching
    try {
      return await this.prisma.repository.create({
        data: {
          userId: recordUserId,
          importedByUserId: userId,
          organizationId: dto.organizationId ?? null,
          connectionId: connectionId ?? null,
          githubRepoId,
          providerRepoId,
          provider: ConnectionProvider.GITHUB,
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
   * Imports a public or private repository from a URL or shorthand (e.g. "https://github.com/owner/repo" or "owner/repo").
   * Fetches metadata dynamically from the provider using an optional connection token.
   */
  async importFromUrl(userId: string, dto: ImportFromUrlDto) {
    if (dto.organizationId) {
      const permissions = await this.organizationsService.getMemberPermissions(
        userId,
        dto.organizationId,
      );
      if (!permissions || !permissions.includes('repo.process')) {
        throw new ForbiddenException(
          'You do not have permission to import repositories in this organization',
        );
      }
    }

    const { provider, owner, repo } = parseRepoUrl(dto.url);

    let connectionId = dto.connectionId;
    let token: string | null = null;
    try {
      token = await this.connectionsService.resolveTokenForRepo({
        userId,
        orgId: dto.organizationId,
        connectionId,
        provider,
      });
    } catch {
      token = null;
    }

    if (!connectionId && token) {
      if (dto.organizationId) {
        const orgConn = await this.connectionsService.findDefaultOrgConnection(
          dto.organizationId,
          provider,
        );
        if (orgConn) connectionId = orgConn.id;
      }
      if (!connectionId) {
        const userConn =
          await this.connectionsService.findDefaultUserConnection(
            userId,
            provider,
          );
        if (userConn) connectionId = userConn.id;
      }
    }

    const meta = await this.connectionsService.fetchRepoMetadata(
      owner,
      repo,
      token,
      provider,
    );

    if (meta.isPrivate && !token) {
      throw new BadRequestException(
        'A valid connection is required to import private repositories.',
      );
    }

    const recordUserId = dto.organizationId ? userId : userId;

    const existing = await this.prisma.repository.findFirst({
      where: {
        organizationId: dto.organizationId ?? null,
        userId: dto.organizationId ? undefined : userId,
        OR: [
          { githubRepoId: meta.providerRepoId },
          { providerRepoId: meta.providerRepoId },
        ],
      },
    });

    if (existing) {
      throw new ConflictException('This repository has already been imported.');
    }

    try {
      return await this.prisma.repository.create({
        data: {
          userId: recordUserId,
          importedByUserId: userId,
          organizationId: dto.organizationId ?? null,
          connectionId: connectionId ?? null,
          githubRepoId: meta.providerRepoId,
          providerRepoId: meta.providerRepoId,
          provider,
          name: meta.name,
          owner: meta.owner,
          defaultBranch: meta.defaultBranch,
          isPrivate: meta.isPrivate,
          cloneUrl: meta.cloneUrl,
          status: RepositoryStatus.IMPORTED,
        },
      });
    } catch (error: any) {
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
    const userOrgs = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const orgIds = userOrgs.map((o) => o.orgId);

    const repos = await this.prisma.repository.findMany({
      where: {
        OR: [{ userId }, { organizationId: { in: orgIds } }],
      },
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
      const permissions = await this.organizationsService.getMemberPermissions(
        userId,
        repo.organizationId,
      );
      if (!permissions || !permissions.includes('repo.delete')) {
        throw new ForbiddenException(
          'You do not have permission to delete repositories in this organization',
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

  /**
   * Retrieves detail metadata for a single imported repository, enforcing
   * that the requesting user has at least `repo.process` permission for
   * org-scoped repos. Use this for write/mutating endpoints (document, ask, etc.).
   * Throws ForbiddenException for Viewers (repo.read only).
   */
  async getImportedByIdForWrite(userId: string, id: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
    });

    if (!repo) {
      throw new NotFoundException('Imported repository not found');
    }

    if (repo.organizationId) {
      const permissions = await this.organizationsService.getMemberPermissions(
        userId,
        repo.organizationId,
      );
      if (!permissions || !permissions.includes(Permission.REPO_PROCESS)) {
        throw new ForbiddenException(
          'You do not have access to this repository',
        );
      }
    } else if (repo.userId !== userId) {
      throw new NotFoundException('Imported repository not found');
    }

    return repo;
  }
}
