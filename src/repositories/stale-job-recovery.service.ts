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
  DocStatus,
  RepositoryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { DOCUMENTATION_QUEUE, DocumentationJobPayload } from './documentation.constants';
import { ANALYSIS_QUEUE, AnalysisJobPayload } from '../analysis/analysis.constants';
import {
  ARCHITECTURE_DRAFT_QUEUE,
  ArchitectureDraftJobPayload,
} from '../architecture-doc/architecture-doc.constants';
import { fromPrismaJson, MAX_RESUME_COUNT } from '../common/pipeline-checkpoint';

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

const ARCH_ACTIVE_STATUSES: DocStatus[] = [
  DocStatus.PENDING,
  DocStatus.RETRIEVING,
  DocStatus.GENERATING,
  DocStatus.VERIFYING,
];

/**
 * On boot, finds orphaned RUNNING/PENDING jobs (no BullMQ entry after threshold)
 * and re-enqueues them so they resume from their checkpoints instead of failing.
 * Only marks a job FAILED if it has exceeded MAX_RESUME_COUNT re-enqueues.
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
    @InjectQueue(ARCHITECTURE_DRAFT_QUEUE)
    private readonly architectureDraftQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recoverDocumentationJobs();
      await this.recoverAnalysisJobs();
      await this.recoverArchitectureDraftJobs();
    } catch (error) {
      this.logger.error(
        `Stale job recovery failed: ${(error as Error).message}`,
      );
    }
  }

  // ── Documentation ──────────────────────────────────────────────────────────

  private async recoverDocumentationJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await this.prisma.documentationJob.findMany({
      where: {
        status: {
          in: [DocumentationJobStatus.PENDING, DocumentationJobStatus.RUNNING],
        },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        repositoryId: true,
        queueJobId: true,
        checkpoint: true,
        resumeCount: true,
      },
    });

    for (const job of stale) {
      if (await this.existsInQueue(this.documentationQueue, job.queueJobId)) {
        continue;
      }

      const checkpoint = fromPrismaJson(job.checkpoint);
      const resumeCount = job.resumeCount ?? 0;

      if (resumeCount >= MAX_RESUME_COUNT) {
        await this.failDocumentationJob(
          job.id,
          job.repositoryId,
          'Exceeded maximum resume attempts; please re-trigger the job',
        );
        continue;
      }

      // Re-enqueue from where it left off
      const repository = await this.prisma.repository.findUnique({
        where: { id: job.repositoryId },
        select: { userId: true },
      });
      if (!repository) continue;

      try {
        const payload: DocumentationJobPayload = {
          repositoryId: job.repositoryId,
          documentationJobId: job.id,
          userId: repository.userId,
        };

        const queueJob = await this.documentationQueue.add('document', payload, {
          jobId: `${job.id}-resume-${resumeCount + 1}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        });

        await this.prisma.documentationJob.update({
          where: { id: job.id },
          data: {
            status: DocumentationJobStatus.PENDING,
            stage: 'queued',
            error: null,
            finishedAt: null,
            queueJobId: String(queueJob.id),
            resumeCount: resumeCount + 1,
            checkpoint: checkpoint as object,
          },
        });

        const fresh = await this.prisma.documentationJob.findUnique({
          where: { id: job.id },
        });
        if (fresh) this.progress.publishDocumentation(job.repositoryId, fresh);

        this.logger.log(
          `Re-enqueued stale documentation job ${job.id} (resume #${resumeCount + 1})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to re-enqueue documentation job ${job.id}: ${(err as Error).message}`,
        );
        await this.failDocumentationJob(job.id, job.repositoryId, 'Failed to re-enqueue after interruption');
      }
    }
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  private async recoverAnalysisJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await this.prisma.analysisJob.findMany({
      where: {
        status: { in: [AnalysisJobStatus.QUEUED, AnalysisJobStatus.RUNNING] },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        repositoryId: true,
        queueJobId: true,
        checkpoint: true,
        resumeCount: true,
      },
    });

    for (const job of stale) {
      if (await this.existsInQueue(this.analysisQueue, job.queueJobId)) {
        continue;
      }

      const checkpoint = fromPrismaJson(job.checkpoint);
      const resumeCount = job.resumeCount ?? 0;

      if (resumeCount >= MAX_RESUME_COUNT) {
        await this.failAnalysisJob(
          job.id,
          job.repositoryId,
          'Exceeded maximum resume attempts; please re-trigger the job',
        );
        continue;
      }

      const repository = await this.prisma.repository.findUnique({
        where: { id: job.repositoryId },
        select: { userId: true },
      });
      if (!repository) continue;

      try {
        const payload: AnalysisJobPayload = {
          repositoryId: job.repositoryId,
          analysisJobId: job.id,
          userId: repository.userId,
        };

        const queueJob = await this.analysisQueue.add('analyze', payload, {
          jobId: `${job.id}-resume-${resumeCount + 1}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        });

        await this.prisma.analysisJob.update({
          where: { id: job.id },
          data: {
            status: AnalysisJobStatus.QUEUED,
            stage: 'queued',
            error: null,
            finishedAt: null,
            queueJobId: String(queueJob.id),
            resumeCount: resumeCount + 1,
            checkpoint: checkpoint as object,
          },
        });

        const fresh = await this.prisma.analysisJob.findUnique({
          where: { id: job.id },
        });
        if (fresh) this.progress.publishAnalysis(job.repositoryId, fresh);

        this.logger.log(
          `Re-enqueued stale analysis job ${job.id} (resume #${resumeCount + 1})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to re-enqueue analysis job ${job.id}: ${(err as Error).message}`,
        );
        await this.failAnalysisJob(job.id, job.repositoryId, 'Failed to re-enqueue after interruption');
      }
    }
  }

  // ── Architecture Draft ─────────────────────────────────────────────────────

  private async recoverArchitectureDraftJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await this.prisma.generatedDoc.findMany({
      where: {
        status: { in: ARCH_ACTIVE_STATUSES },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        repositoryId: true,
        triggeredByUserId: true,
        checkpoint: true,
        resumeCount: true,
      },
    });

    for (const doc of stale) {
      if (await this.existsInQueue(this.architectureDraftQueue, doc.id)) {
        continue;
      }

      const checkpoint = fromPrismaJson(doc.checkpoint);
      const resumeCount = doc.resumeCount ?? 0;

      if (resumeCount >= MAX_RESUME_COUNT) {
        await this.prisma.generatedDoc.update({
          where: { id: doc.id },
          data: {
            status: DocStatus.FAILED,
            errorMessage: 'Exceeded maximum resume attempts; please re-trigger',
          },
        });
        this.progress.publishArchDoc(doc.repositoryId, {
          jobId: doc.id,
          docId: doc.id,
          status: DocStatus.FAILED,
          errorMessage: 'Exceeded maximum resume attempts; please re-trigger',
        });
        continue;
      }

      if (!doc.triggeredByUserId) continue;

      try {
        const payload: ArchitectureDraftJobPayload = {
          repositoryId: doc.repositoryId,
          documentId: doc.id,
          userId: doc.triggeredByUserId,
        };

        await this.architectureDraftQueue.add('draft', payload, {
          jobId: `${doc.id}-resume-${resumeCount + 1}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        });

        await this.prisma.generatedDoc.update({
          where: { id: doc.id },
          data: {
            status: DocStatus.PENDING,
            errorMessage: null,
            resumeCount: resumeCount + 1,
            checkpoint: checkpoint as object,
          },
        });

        this.progress.publishArchDoc(doc.repositoryId, {
          jobId: doc.id,
          docId: doc.id,
          status: DocStatus.PENDING,
          errorMessage: null,
        });

        this.logger.log(
          `Re-enqueued stale architecture draft ${doc.id} (resume #${resumeCount + 1})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to re-enqueue architecture draft ${doc.id}: ${(err as Error).message}`,
        );
        await this.prisma.generatedDoc.update({
          where: { id: doc.id },
          data: {
            status: DocStatus.FAILED,
            errorMessage: 'Failed to re-enqueue after interruption',
          },
        });
      }
    }
  }

  // ── Fail helpers ────────────────────────────────────────────────────────────

  private async failDocumentationJob(
    jobId: string,
    repositoryId: string,
    error: string,
  ): Promise<void> {
    await this.prisma.documentationJob.updateMany({
      where: {
        id: jobId,
        status: {
          in: [DocumentationJobStatus.PENDING, DocumentationJobStatus.RUNNING],
        },
      },
      data: { status: DocumentationJobStatus.FAILED, error, finishedAt: new Date() },
    });

    await this.prisma.repository
      .updateMany({
        where: {
          id: repositoryId,
          status: { in: [RepositoryStatus.CLONING, RepositoryStatus.INDEXING] },
        },
        data: { status: RepositoryStatus.FAILED },
      })
      .catch(() => undefined);

    const fresh = await this.prisma.documentationJob.findUnique({
      where: { id: jobId },
    });
    if (fresh) this.progress.publishDocumentation(repositoryId, fresh);
    this.logger.warn(`Permanently failed documentation job ${jobId}: ${error}`);
  }

  private async failAnalysisJob(
    jobId: string,
    repositoryId: string,
    error: string,
  ): Promise<void> {
    await this.prisma.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: [AnalysisJobStatus.QUEUED, AnalysisJobStatus.RUNNING] },
      },
      data: { status: AnalysisJobStatus.FAILED, error, finishedAt: new Date() },
    });

    const fresh = await this.prisma.analysisJob.findUnique({
      where: { id: jobId },
    });
    if (fresh) this.progress.publishAnalysis(repositoryId, fresh);
    this.logger.warn(`Permanently failed analysis job ${jobId}: ${error}`);
  }

  // ── Queue existence check ───────────────────────────────────────────────────

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
