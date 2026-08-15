import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DocumentationJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import {
  DOCUMENTATION_QUEUE,
  DocumentationJobPayload,
} from '../repositories/documentation.constants';
import { fromPrismaJson, toPrismaJson } from '../common/pipeline-checkpoint';
import { AdminListDocumentationJobsQueryDto } from './dto/admin-list-documentation-jobs-query.dto';
import { AdminDocumentationJobListResponseDto } from './dto/admin-documentation-job-list-response.dto';
import { AdminDocumentationJobDetailDto } from './dto/admin-documentation-job-detail.dto';
import {
  AdminDocumentationJobOwnerUserDto,
  AdminDocumentationJobRepositoryDto,
  AdminDocumentationJobSummaryDto,
} from './dto/admin-documentation-job-summary.dto';

type DocumentationJobWithRelations = {
  id: string;
  status: DocumentationJobStatus;
  stage: string | null;
  progress: number | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  queueJobId?: string | null;
  resumeCount?: number;
  repository: {
    id: string;
    name: string;
    owner: string;
    isPrivate: boolean;
    user: {
      id: string;
      email: string | null;
      fullName: string | null;
      avatar: string | null;
    };
  };
};

const JOB_INCLUDE = {
  repository: {
    select: {
      id: true,
      name: true,
      owner: true,
      isPrivate: true,
      user: { select: { id: true, email: true, fullName: true, avatar: true } },
    },
  },
} satisfies Prisma.DocumentationJobInclude;

/**
 * ADMIN-only access to platform-wide documentation generation jobs: listing,
 * detail and retry of failed jobs. Retrying re-enqueues the same job row so it
 * resumes from its checkpoint, mirroring the stale-job recovery flow.
 */
@Injectable()
export class AdminDocumentationJobsService {
  private readonly logger = new Logger(AdminDocumentationJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    @InjectQueue(DOCUMENTATION_QUEUE)
    private readonly documentationQueue: Queue,
  ) {}

  async listJobs(
    query: AdminListDocumentationJobsQueryDto,
  ): Promise<AdminDocumentationJobListResponseDto> {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const search = query.search?.trim();

    const where: Prisma.DocumentationJobWhereInput = {
      ...(search
        ? {
            OR: [
              {
                repository: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
              {
                repository: {
                  owner: { contains: search, mode: 'insensitive' as const },
                },
              },
              {
                repository: {
                  user: {
                    fullName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              },
              {
                repository: {
                  user: {
                    email: { contains: search, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [jobs, total] = await this.prisma.$transaction([
      this.prisma.documentationJob.findMany({
        where,
        include: JOB_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.documentationJob.count({ where }),
    ]);

    const items: AdminDocumentationJobSummaryDto[] = jobs.map((job) =>
      this.toSummary(job),
    );

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

  async getJobById(id: string): Promise<AdminDocumentationJobDetailDto> {
    const job = await this.prisma.documentationJob.findUnique({
      where: { id },
      include: JOB_INCLUDE,
    });

    if (!job) {
      throw new NotFoundException(`Documentation job with ID ${id} not found`);
    }

    return this.toDetail(job);
  }

  /**
   * Re-enqueues a failed documentation job so the pipeline resumes from its
   * checkpoint. Only FAILED jobs can be retried; non-terminal jobs are rejected.
   */
  async retryJob(
    id: string,
    requestingAdminId: string,
  ): Promise<AdminDocumentationJobDetailDto> {
    const job = await this.prisma.documentationJob.findUnique({
      where: { id },
      include: JOB_INCLUDE,
    });

    if (!job) {
      throw new NotFoundException(`Documentation job with ID ${id} not found`);
    }

    if (job.status !== DocumentationJobStatus.FAILED) {
      throw new ConflictException(
        `Only failed documentation jobs can be retried (current status: ${job.status})`,
      );
    }

    const resumeCount = job.resumeCount ?? 0;
    const payload: DocumentationJobPayload = {
      repositoryId: job.repositoryId,
      documentationJobId: job.id,
      userId: job.repository.user.id,
    };

    const queueJob = await this.documentationQueue.add('document', payload, {
      jobId: `${job.id}-retry-${resumeCount + 1}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    const checkpoint = fromPrismaJson(job.checkpoint);

    const updated = await this.prisma.documentationJob.update({
      where: { id: job.id },
      data: {
        status: DocumentationJobStatus.PENDING,
        stage: 'queued',
        progress: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        queueJobId: String(queueJob.id),
        resumeCount: resumeCount + 1,
        checkpoint: toPrismaJson(checkpoint),
      },
      include: JOB_INCLUDE,
    });

    this.progress.publishDocumentation(job.repositoryId, updated);

    this.logger.log(
      `Admin ${requestingAdminId} retried documentation job ${job.id} for repository ${job.repositoryId}`,
    );

    return this.toDetail(updated);
  }

  private toSummary(
    job: DocumentationJobWithRelations,
  ): AdminDocumentationJobSummaryDto {
    const repository: AdminDocumentationJobRepositoryDto = {
      id: job.repository.id,
      name: job.repository.name,
      owner: job.repository.owner,
      githubUrl: this.toGithubUrl(job.repository.owner, job.repository.name),
      isPrivate: job.repository.isPrivate,
    };
    const user: AdminDocumentationJobOwnerUserDto = {
      id: job.repository.user.id,
      email: job.repository.user.email,
      fullName: job.repository.user.fullName,
      avatar: job.repository.user.avatar,
    };

    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      repository,
      user,
    };
  }

  private toDetail(
    job: DocumentationJobWithRelations,
  ): AdminDocumentationJobDetailDto {
    return {
      ...this.toSummary(job),
      queueJobId: job.queueJobId ?? null,
      resumeCount: job.resumeCount ?? 0,
    };
  }

  private toGithubUrl(owner: string, name: string): string {
    return `https://github.com/${owner}/${name}`;
  }
}
