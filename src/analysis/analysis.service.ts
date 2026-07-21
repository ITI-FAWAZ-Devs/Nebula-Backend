import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AnalysisJobStatus, RepositoryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ANALYSIS_QUEUE,
  AnalysisJobPayload,
} from './analysis.constants';

@Injectable()
export class AnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
  ) {}

  async startAnalysis(userId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this repository',
      );
    }

    // Prevent concurrent analysis of the same repo
    const activeJob = await this.prisma.analysisJob.findFirst({
      where: {
        repositoryId,
        status: {
          in: [AnalysisJobStatus.QUEUED, AnalysisJobStatus.RUNNING],
        },
      },
    });

    if (activeJob) {
      throw new ConflictException(
        'An analysis job is already in progress for this repository',
      );
    }

    const job = await this.prisma.analysisJob.create({
      data: {
        repositoryId,
        status: AnalysisJobStatus.QUEUED,
        stage: 'queued',
      },
    });

    await this.prisma.repository.update({
      where: { id: repositoryId },
      data: { status: RepositoryStatus.CLONING },
    });

    const payload: AnalysisJobPayload = {
      repositoryId,
      analysisJobId: job.id,
      userId,
    };

    const queueJob = await this.analysisQueue.add('analyze', payload, {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    await this.prisma.analysisJob.update({
      where: { id: job.id },
      data: { queueJobId: String(queueJob.id) },
    });

    return {
      ...job,
      queueJobId: String(queueJob.id),
    };
  }

  async getLatestJob(userId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this repository',
      );
    }

    const job = await this.prisma.analysisJob.findFirst({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
    });

    if (!job) {
      throw new NotFoundException('No analysis job found for this repository');
    }

    return job;
  }
}
