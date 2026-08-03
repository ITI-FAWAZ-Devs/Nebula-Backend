import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AnalysisJobStatus,
  DocumentationJobStatus,
  RepositoryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { DOCUMENTATION_QUEUE } from './documentation.constants';
import { ANALYSIS_QUEUE } from '../analysis/analysis.constants';

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Marks jobs that can never complete (orphaned RUNNING/PENDING rows whose
 * BullMQ entry no longer exists — e.g. the process died before enqueueing or
 * Redis lost the job) as FAILED so the frontend pipeline surfaces a retryable
 * error instead of polling forever. Jobs still present in their queue are left
 * untouched: the worker will pick them up again after a restart.
 */
@Injectable()
export class StaleJobRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleJobRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    @InjectQueue(DOCUMENTATION_QUEUE)
    private readonly documentationQueue: Queue,
    @InjectQueue(ANALYSIS_QUEUE)
    private readonly analysisQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recoverDocumentationJobs();
      await this.recoverAnalysisJobs();
    } catch (error) {
      this.logger.error(
        `Stale job recovery failed: ${(error as Error).message}`,
      );
    }
  }

  private async recoverDocumentationJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await this.prisma.documentationJob.findMany({
      where: {
        status: {
          in: [DocumentationJobStatus.PENDING, DocumentationJobStatus.RUNNING],
        },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, repositoryId: true, queueJobId: true },
    });

    for (const job of stale) {
      if (await this.existsInQueue(this.documentationQueue, job.queueJobId)) {
        continue;
      }

      const updated = await this.prisma.documentationJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: [DocumentationJobStatus.PENDING, DocumentationJobStatus.RUNNING],
          },
        },
        data: {
          status: DocumentationJobStatus.FAILED,
          error: 'Interrupted by service restart; re-run documentation',
          finishedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        continue;
      }

      await this.prisma.repository
        .updateMany({
          where: {
            id: job.repositoryId,
            status: { in: [RepositoryStatus.CLONING, RepositoryStatus.INDEXING] },
          },
          data: { status: RepositoryStatus.FAILED },
        })
        .catch(() => undefined);

      const fresh = await this.prisma.documentationJob.findUnique({
        where: { id: job.id },
      });
      if (fresh) {
        this.progress.publishDocumentation(job.repositoryId, fresh);
      }
      this.logger.warn(
        `Marked stale documentation job ${job.id} as FAILED (interrupted)`,
      );
    }
  }

  private async recoverAnalysisJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await this.prisma.analysisJob.findMany({
      where: {
        status: { in: [AnalysisJobStatus.QUEUED, AnalysisJobStatus.RUNNING] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, repositoryId: true, queueJobId: true },
    });

    for (const job of stale) {
      if (await this.existsInQueue(this.analysisQueue, job.queueJobId)) {
        continue;
      }

      const updated = await this.prisma.analysisJob.updateMany({
        where: {
          id: job.id,
          status: { in: [AnalysisJobStatus.QUEUED, AnalysisJobStatus.RUNNING] },
        },
        data: {
          status: AnalysisJobStatus.FAILED,
          error: 'Interrupted by service restart; re-run analysis',
          finishedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        continue;
      }

      const fresh = await this.prisma.analysisJob.findUnique({
        where: { id: job.id },
      });
      if (fresh) {
        this.progress.publishAnalysis(job.repositoryId, fresh);
      }
      this.logger.warn(
        `Marked stale analysis job ${job.id} as FAILED (interrupted)`,
      );
    }
  }

  private async existsInQueue(
    queue: Queue,
    queueJobId: string | null,
  ): Promise<boolean> {
    if (!queueJobId) return false;
    try {
      const job = await queue.getJob(queueJobId);
      return !!job;
    } catch {
      return false;
    }
  }
}
