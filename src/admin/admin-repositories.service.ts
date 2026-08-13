import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AnalysisJobStatus,
  DocumentationJobStatus,
  DocStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChromaService } from '../chroma/chroma.service';
import { GitService } from '../git/git.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { ArchitectureDocService } from '../architecture-doc/architecture-doc.service';
import { ArchitectureDocRegenerateResponse } from '../architecture-doc/dto/architecture-doc.dto';
import { AdminListRepositoriesQueryDto } from './dto/admin-list-repositories-query.dto';
import { AdminRepositoryListResponseDto } from './dto/admin-repository-list-response.dto';
import { AdminRepositorySummaryDto } from './dto/admin-repository-summary.dto';
import { AdminRepositoryDetailDto } from './dto/admin-repository-detail.dto';

const ACTIVE_DOC_STATUSES: DocStatus[] = [
  DocStatus.PENDING,
  DocStatus.RETRIEVING,
  DocStatus.GENERATING,
  DocStatus.VERIFYING,
];

const ACTIVE_DOCUMENTATION_JOB_STATUSES: DocumentationJobStatus[] = [
  DocumentationJobStatus.PENDING,
  DocumentationJobStatus.RUNNING,
];

const ACTIVE_ANALYSIS_JOB_STATUSES: AnalysisJobStatus[] = [
  AnalysisJobStatus.QUEUED,
  AnalysisJobStatus.RUNNING,
];

/**
 * Job types recorded in `UsageLog` that represent Q&A requests against a
 * repository. Today no caller writes these tags (Q&A via `AskService` and the
 * agent is not metered), so counts are 0 — but the field is wired to the
 * existing `UsageLog` table and lights up as soon as Q&A usage logging exists.
 */
const QA_JOB_TYPES = ['QA_ASK', 'AGENT_QA'];

@Injectable()
export class AdminRepositoriesService {
  private readonly logger = new Logger(AdminRepositoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chromaService: ChromaService,
    private readonly gitService: GitService,
    private readonly neo4jService: Neo4jService,
    private readonly architectureDocService: ArchitectureDocService,
  ) {}

  async listRepositories(
    query: AdminListRepositoriesQueryDto,
  ): Promise<AdminRepositoryListResponseDto> {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const search = query.search?.trim();

    const where: Prisma.RepositoryWhereInput = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { owner: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.repositoryStatus ? { status: query.repositoryStatus } : {}),
      // Matches repositories that have at least one documentation generation
      // in the requested status. The latest-version status is computed when
      // mapping each item.
      ...(query.documentationStatus
        ? { generatedDocs: { some: { status: query.documentationStatus } } }
        : {}),
      ...(query.owner
        ? { owner: { contains: query.owner, mode: 'insensitive' as const } }
        : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const [repositories, total] = await this.prisma.$transaction([
      this.prisma.repository.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, fullName: true, avatar: true },
          },
          organization: { select: { id: true, name: true } },
          generatedDocs: {
            orderBy: { version: 'desc' },
            select: {
              id: true,
              version: true,
              status: true,
              generatedAt: true,
            },
            take: 1,
          },
        },
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.repository.count({ where }),
    ]);

    const usageCounts = await this.usageCountsForRepositories(
      repositories.map((repo) => repo.id),
    );

    const items: AdminRepositorySummaryDto[] = repositories.map((repo) => {
      const latestDoc = repo.generatedDocs[0] ?? null;
      return {
        id: repo.id,
        name: repo.name,
        githubUrl: this.toGithubUrl(repo.owner, repo.name),
        owner: repo.owner,
        isPrivate: repo.isPrivate,
        user: {
          id: repo.user.id,
          email: repo.user.email,
          fullName: repo.user.fullName,
          avatar: repo.user.avatar,
        },
        importDate: repo.createdAt,
        repositoryStatus: repo.status,
        documentationStatus: latestDoc ? latestDoc.status : 'NOT_GENERATED',
        lastDocumentationGeneration: repo.lastDocumentedAt,
        lastArchDocGeneratedAt: latestDoc?.generatedAt ?? null,
        qaRequestsCount: usageCounts.get(repo.id)?.qa ?? 0,
        usageLogsCount: usageCounts.get(repo.id)?.all ?? 0,
      };
    });

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

  async getRepositoryById(id: string): Promise<AdminRepositoryDetailDto> {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, avatar: true },
        },
        organization: { select: { id: true, name: true } },
        documentationJobs: { orderBy: { createdAt: 'desc' }, take: 1 },
        generatedDocs: { orderBy: { version: 'desc' } },
        _count: {
          select: {
            documentationJobs: true,
            analysisJobs: true,
          },
        },
      },
    });

    if (!repo) {
      throw new NotFoundException(`Repository with ID ${id} not found`);
    }

    const [allUsage, qaUsage] = await this.prisma.$transaction([
      this.prisma.usageLog.count({ where: { repositoryId: id } }),
      this.prisma.usageLog.count({
        where: { repositoryId: id, jobType: { in: QA_JOB_TYPES } },
      }),
    ]);

    const latestDoc = repo.generatedDocs[0] ?? null;
    const latestJob = repo.documentationJobs[0] ?? null;

    return {
      id: repo.id,
      name: repo.name,
      githubUrl: this.toGithubUrl(repo.owner, repo.name),
      githubRepoId: repo.githubRepoId,
      owner: repo.owner,
      defaultBranch: repo.defaultBranch,
      isPrivate: repo.isPrivate,
      user: {
        id: repo.user.id,
        email: repo.user.email,
        fullName: repo.user.fullName,
        avatar: repo.user.avatar,
      },
      organization: repo.organization,
      repositoryStatus: repo.status,
      documentationStatus: latestDoc ? latestDoc.status : 'NOT_GENERATED',
      importDate: repo.createdAt,
      lastDocumentationGeneration: repo.lastDocumentedAt,
      lastIndexedCommit: repo.lastIndexedCommit,
      documentedCommit: repo.documentedCommit,
      latestDocumentationJob: latestJob
        ? {
            id: latestJob.id,
            status: latestJob.status,
            stage: latestJob.stage,
            progress: latestJob.progress,
            error: latestJob.error,
            startedAt: latestJob.startedAt,
            finishedAt: latestJob.finishedAt,
            createdAt: latestJob.createdAt,
          }
        : null,
      latestGeneratedDoc: latestDoc
        ? {
            id: latestDoc.id,
            version: latestDoc.version,
            status: latestDoc.status,
            commitSha: latestDoc.commitSha,
            generatedAt: latestDoc.generatedAt,
            verificationScore: latestDoc.verificationScore,
            triggeredByUserId: latestDoc.triggeredByUserId,
            createdAt: latestDoc.createdAt,
          }
        : null,
      generatedDocVersions: repo.generatedDocs.map((doc) => ({
        id: doc.id,
        version: doc.version,
        status: doc.status,
        commitSha: doc.commitSha,
        generatedAt: doc.generatedAt,
        verificationScore: doc.verificationScore,
        triggeredByUserId: doc.triggeredByUserId,
        createdAt: doc.createdAt,
      })),
      documentationJobsCount: repo._count.documentationJobs,
      analysisJobsCount: repo._count.analysisJobs,
      usageLogsCount: allUsage,
      qaRequestsCount: qaUsage,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    };
  }

  /**
   * Deletes a repository and everything derived from it. Refuses when any
   * documentation / analysis / documentation-generation job is still in
   * flight, then removes the relational row (Prisma cascades to analysis and
   * documentation jobs, generated docs and sections) and best-effort cleans
   * the external artifacts: Chroma embeddings, the Neo4j knowledge graph and
   * the on-disk clone.
   */
  async deleteRepository(
    id: string,
    requestingAdminId: string,
  ): Promise<{ id: string; name: string }> {
    const repo = await this.prisma.repository.findUnique({ where: { id } });

    if (!repo) {
      throw new NotFoundException(`Repository with ID ${id} not found`);
    }

    const [documentationJobsInFlight, analysisJobsInFlight, docsInFlight] =
      await this.prisma.$transaction([
        this.prisma.documentationJob.count({
          where: {
            repositoryId: id,
            status: { in: ACTIVE_DOCUMENTATION_JOB_STATUSES },
          },
        }),
        this.prisma.analysisJob.count({
          where: {
            repositoryId: id,
            status: { in: ACTIVE_ANALYSIS_JOB_STATUSES },
          },
        }),
        this.prisma.generatedDoc.count({
          where: { repositoryId: id, status: { in: ACTIVE_DOC_STATUSES } },
        }),
      ]);

    if (
      documentationJobsInFlight > 0 ||
      analysisJobsInFlight > 0 ||
      docsInFlight > 0
    ) {
      throw new ConflictException(
        `Cannot delete repository: ${documentationJobsInFlight} documentation indexing job(s), ${analysisJobsInFlight} analysis job(s) and ${docsInFlight} documentation generation(s) are still in progress. Wait for them to finish or mark them failed first.`,
      );
    }

    // Remove the source-of-truth row first (cascades to jobs, docs, sections);
    // the usage log has no FK to the repository so it is cleaned explicitly.
    await this.prisma.$transaction([
      this.prisma.usageLog.deleteMany({ where: { repositoryId: id } }),
      this.prisma.repository.delete({ where: { id } }),
    ]);

    // Best-effort cleanup of derived/external data. Failures are logged and do
    // not fail the deletion: the artifacts are regenerable from source control.
    await this.chromaService.deleteCollectionsByPrefix(`repo-${id}`);
    await this.neo4jService
      .deleteGraph(id)
      .catch((err) =>
        this.logger.warn(
          `Failed to delete Neo4j graph for repository ${id}: ${(err as Error).message}`,
        ),
      );
    if (repo.localPath) {
      await this.gitService
        .delete(repo.localPath)
        .catch((err) =>
          this.logger.warn(
            `Failed to delete local clone at ${repo.localPath}: ${(err as Error).message}`,
          ),
        );
    }

    this.logger.log(
      `Admin ${requestingAdminId} deleted repository ${id} (${repo.name})`,
    );

    return { id: repo.id, name: repo.name };
  }

  /**
   * Triggers regeneration of a repository's latest architecture document.
   * Delegates to `ArchitectureDocService` which reuses the existing drafting
   * pipeline, queue and subscription/quota logic.
   */
  async regenerateDocumentation(
    repositoryId: string,
    requestingAdminId: string,
  ): Promise<ArchitectureDocRegenerateResponse> {
    const response =
      await this.architectureDocService.regenerateForAdmin(repositoryId);
    this.logger.log(
      `Admin ${requestingAdminId} triggered documentation regeneration for repository ${repositoryId}`,
    );
    return response;
  }

  private async usageCountsForRepositories(
    repositoryIds: string[],
  ): Promise<Map<string, { all: number; qa: number }>> {
    const counts = new Map<string, { all: number; qa: number }>();
    if (repositoryIds.length === 0) return counts;

    const [allRows, qaRows] = await this.prisma.$transaction([
      this.prisma.usageLog.groupBy({
        by: ['repositoryId'],
        where: { repositoryId: { in: repositoryIds } },
        orderBy: { repositoryId: 'asc' },
        _count: { repositoryId: true },
      }),
      this.prisma.usageLog.groupBy({
        by: ['repositoryId'],
        where: {
          repositoryId: { in: repositoryIds },
          jobType: { in: QA_JOB_TYPES },
        },
        orderBy: { repositoryId: 'asc' },
        _count: { repositoryId: true },
      }),
    ]);

    for (const row of allRows) {
      counts.set(row.repositoryId as string, {
        all: (row._count as { repositoryId: number }).repositoryId ?? 0,
        qa: 0,
      });
    }
    for (const row of qaRows) {
      const current = counts.get(row.repositoryId as string) ?? {
        all: 0,
        qa: 0,
      };
      current.qa = (row._count as { repositoryId: number }).repositoryId ?? 0;
      counts.set(row.repositoryId as string, current);
    }

    return counts;
  }

  private toGithubUrl(owner: string, name: string): string {
    return `https://github.com/${owner}/${name}`;
  }
}
