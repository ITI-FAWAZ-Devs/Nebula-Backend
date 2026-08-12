import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentationJobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listUsers(params: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(params.page ?? 1, 1);
    const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
    const search = params.search?.trim();

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { fullName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

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
          _count: {
            select: {
              repositories: true,
              usageLogs: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
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
