import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthProvider,
  DocumentationJobStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUserDetailDto } from './dto/admin-user-detail.dto';
import { AdminUserListResponseDto } from './dto/admin-user-list-response.dto';
import { AdminUserSummaryDto } from './dto/admin-user-summary.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listUsers(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: UserRole;
  }): Promise<AdminUserListResponseDto> {
    const page = Math.max(params.page ?? 1, 1);
    const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
    const search = params.search?.trim();

    const where: Prisma.UserWhereInput = {
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { fullName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(params.role ? { role: params.role } : {}),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          avatar: true,
          role: true,
          isEmailVerified: true,
          subscriptionTier: true,
          createdAt: true,
          updatedAt: true,
          githubToken: { select: { id: true } },
          _count: {
            select: {
              repositories: true,
              usageLogs: true,
              accounts: { where: { provider: AuthProvider.GITHUB } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const items: AdminUserSummaryDto[] = users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatar: user.avatar,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      subscriptionTier: user.subscriptionTier,
      githubConnected: user.githubToken !== null || user._count.accounts > 0,
      repositoriesCount: user._count.repositories,
      usageLogsCount: user._count.usageLogs,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Returns aggregated, non-sensitive details for a single user.
   */
  async getUserById(id: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatar: true,
        role: true,
        isEmailVerified: true,
        subscriptionTier: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        totalGenerationsUsed: true,
        generationsUsedThisPeriod: true,
        createdAt: true,
        updatedAt: true,
        githubToken: { select: { id: true } },
        accounts: {
          select: {
            provider: true,
            providerUsername: true,
            providerAvatar: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        usageLogs: {
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            repositories: true,
            usageLogs: true,
            memberships: true,
            ownedOrganizations: true,
            accounts: { where: { provider: AuthProvider.GITHUB } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatar: user.avatar,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      subscriptionTier: user.subscriptionTier,
      githubConnected: user.githubToken !== null || user._count.accounts > 0,
      repositoriesCount: user._count.repositories,
      usageLogsCount: user._count.usageLogs,
      currentPeriodStart: user.currentPeriodStart,
      currentPeriodEnd: user.currentPeriodEnd,
      totalGenerationsUsed: user.totalGenerationsUsed,
      generationsUsedThisPeriod: user.generationsUsedThisPeriod,
      organizationsCount: user._count.memberships,
      ownedOrganizationsCount: user._count.ownedOrganizations,
      lastUsageAt: user.usageLogs[0]?.createdAt ?? null,
      accounts: user.accounts.map((account) => ({
        provider: account.provider,
        providerUsername: account.providerUsername,
        providerAvatar: account.providerAvatar,
        createdAt: account.createdAt,
      })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Deletes a user account. Refuses when the user owns repositories or
   * organizations, when the caller targets their own account, or when the
   * target is the last remaining admin.
   */
  async deleteUser(userId: string, requestingAdminId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.id === requestingAdminId) {
      throw new ConflictException('You cannot delete your own account');
    }

    if (user.role === UserRole.ADMIN) {
      const otherAdmins = await this.prisma.user.count({
        where: { role: UserRole.ADMIN, id: { not: userId } },
      });
      if (otherAdmins === 0) {
        throw new ConflictException(
          'Cannot delete the last admin user. Promote another user to admin first.',
        );
      }
    }

    const [repositoryCount, ownedOrganizationCount] =
      await this.prisma.$transaction([
        this.prisma.repository.count({ where: { userId } }),
        this.prisma.organization.count({ where: { ownerId: userId } }),
      ]);

    if (repositoryCount > 0) {
      throw new ConflictException(
        `Cannot delete user: they own ${repositoryCount} imported ${
          repositoryCount === 1 ? 'repository' : 'repositories'
        }. Delete or reassign them first.`,
      );
    }

    if (ownedOrganizationCount > 0) {
      throw new ConflictException(
        `Cannot delete user: they own ${ownedOrganizationCount} ${
          ownedOrganizationCount === 1 ? 'organization' : 'organizations'
        }. Transfer ownership or delete them first.`,
      );
    }

    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.log(`Admin ${requestingAdminId} deleted user ${userId}`);
  }

  async getStats() {
    const [users, repositories, generatedDocs, docSections, usageLogs] =
      await this.prisma.$transaction([
        this.prisma.user.count(),
        this.prisma.repository.count(),
        this.prisma.generatedDoc.count(),
        this.prisma.docSection.count(),
        this.prisma.usageLog.count(),
      ]);

    return {
      users,
      repositories,
      generatedDocs,
      docSections,
      usageLogs,
    };
  }

  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      totalImportedRepositories,
      totalDocumentationJobs,
      successfulDocumentationJobs,
      failedDocumentationJobs,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isEmailVerified: true } }),
      this.prisma.repository.count(),
      this.prisma.documentationJob.count(),
      this.prisma.documentationJob.count({
        where: { status: DocumentationJobStatus.COMPLETED },
      }),
      this.prisma.documentationJob.count({
        where: { status: DocumentationJobStatus.FAILED },
      }),
    ]);

    return {
      totalUsers,
      activeUsers,
      totalImportedRepositories,
      totalDocumentationJobs,
      successfulDocumentationJobs,
      failedDocumentationJobs,
    };
  }

  async updateUserRole(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        updatedAt: true,
      },
    });

    this.logger.log(`User ${userId} role changed to ${role}`);
    return updated;
  }
}
