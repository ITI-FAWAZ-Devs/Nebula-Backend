import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { StaleJobRecoveryService } from './stale-job-recovery.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { DOCUMENTATION_QUEUE } from './documentation.constants';
import { ANALYSIS_QUEUE } from '../analysis/analysis.constants';
import { ARCHITECTURE_DRAFT_QUEUE } from '../architecture-doc/architecture-doc.constants';
import {
  AnalysisJobStatus,
  DocumentationJobStatus,
  DocStatus,
  RepositoryStatus,
} from '@prisma/client';

function makeQueue(jobs: Record<string, unknown> = {}) {
  return {
    getJob: jest.fn(async (id: string) => jobs[id] ?? null),
    add: jest.fn().mockResolvedValue({ id: 'new-queue-job' }),
  };
}

const makePrisma = () => ({
  documentationJob: {
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue({ id: 'doc-job-1' }),
  },
  analysisJob: {
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue({ id: 'ana-job-1' }),
  },
  generatedDoc: {
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  repository: {
    findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
});

const makeProgress = () => ({
  publishDocumentation: jest.fn(),
  publishAnalysis: jest.fn(),
  publishArchDoc: jest.fn(),
});

describe('StaleJobRecoveryService', () => {
  let service: StaleJobRecoveryService;
  let prisma: ReturnType<typeof makePrisma>;
  let progress: ReturnType<typeof makeProgress>;
  let docQueue: ReturnType<typeof makeQueue>;
  let analysisQueue: ReturnType<typeof makeQueue>;
  let archQueue: ReturnType<typeof makeQueue>;

  const staleDoc = {
    id: 'doc-job-1',
    repositoryId: 'repo-1',
    queueJobId: null,
    checkpoint: null,
    resumeCount: 0,
  };

  const staleAnalysis = {
    id: 'ana-job-1',
    repositoryId: 'repo-1',
    queueJobId: null,
    checkpoint: null,
    resumeCount: 0,
  };

  const staleArch = {
    id: 'arch-doc-1',
    repositoryId: 'repo-1',
    triggeredByUserId: 'user-1',
    checkpoint: null,
    resumeCount: 0,
  };

  beforeEach(async () => {
    prisma = makePrisma();
    progress = makeProgress();
    docQueue = makeQueue();
    analysisQueue = makeQueue();
    archQueue = makeQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaleJobRecoveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProgressEventsService, useValue: progress },
        { provide: getQueueToken(DOCUMENTATION_QUEUE), useValue: docQueue },
        { provide: getQueueToken(ANALYSIS_QUEUE), useValue: analysisQueue },
        {
          provide: getQueueToken(ARCHITECTURE_DRAFT_QUEUE),
          useValue: archQueue,
        },
      ],
    }).compile();

    service = module.get<StaleJobRecoveryService>(StaleJobRecoveryService);
  });

  describe('documentation job recovery', () => {
    it('re-enqueues orphaned documentation job instead of failing', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([staleDoc]);
      prisma.analysisJob.findMany.mockResolvedValue([]);
      prisma.generatedDoc.findMany.mockResolvedValue([]);

      await service.onApplicationBootstrap();

      expect(docQueue.add).toHaveBeenCalledWith(
        'document',
        expect.objectContaining({ documentationJobId: 'doc-job-1' }),
        expect.any(Object),
      );
      expect(prisma.documentationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DocumentationJobStatus.PENDING,
            resumeCount: 1,
          }),
        }),
      );
    });

    it('marks doc job FAILED after exceeding MAX_RESUME_COUNT', async () => {
      const exhausted = { ...staleDoc, resumeCount: 5 };
      prisma.documentationJob.findMany.mockResolvedValue([exhausted]);
      prisma.analysisJob.findMany.mockResolvedValue([]);
      prisma.generatedDoc.findMany.mockResolvedValue([]);

      await service.onApplicationBootstrap();

      expect(docQueue.add).not.toHaveBeenCalled();
      expect(prisma.documentationJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DocumentationJobStatus.FAILED,
          }),
        }),
      );
    });

    it('skips doc job already present in queue', async () => {
      const present = { ...staleDoc, queueJobId: 'existing-queue-job' };
      prisma.documentationJob.findMany.mockResolvedValue([present]);
      prisma.analysisJob.findMany.mockResolvedValue([]);
      prisma.generatedDoc.findMany.mockResolvedValue([]);
      docQueue.getJob.mockResolvedValue({ id: 'existing-queue-job' });

      await service.onApplicationBootstrap();

      expect(docQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('analysis job recovery', () => {
    it('re-enqueues orphaned analysis job', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([]);
      prisma.analysisJob.findMany.mockResolvedValue([staleAnalysis]);
      prisma.generatedDoc.findMany.mockResolvedValue([]);

      await service.onApplicationBootstrap();

      expect(analysisQueue.add).toHaveBeenCalledWith(
        'analyze',
        expect.objectContaining({ analysisJobId: 'ana-job-1' }),
        expect.any(Object),
      );
      expect(prisma.analysisJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AnalysisJobStatus.QUEUED,
            resumeCount: 1,
          }),
        }),
      );
    });
  });

  describe('architecture draft recovery', () => {
    it('re-enqueues orphaned architecture draft job', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([]);
      prisma.analysisJob.findMany.mockResolvedValue([]);
      prisma.generatedDoc.findMany.mockResolvedValue([staleArch]);

      await service.onApplicationBootstrap();

      expect(archQueue.add).toHaveBeenCalledWith(
        'draft',
        expect.objectContaining({ documentId: 'arch-doc-1' }),
        expect.any(Object),
      );
      expect(prisma.generatedDoc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DocStatus.PENDING,
            resumeCount: 1,
          }),
        }),
      );
    });

    it('marks arch draft FAILED after exceeding MAX_RESUME_COUNT', async () => {
      const exhausted = { ...staleArch, resumeCount: 5 };
      prisma.documentationJob.findMany.mockResolvedValue([]);
      prisma.analysisJob.findMany.mockResolvedValue([]);
      prisma.generatedDoc.findMany.mockResolvedValue([exhausted]);

      await service.onApplicationBootstrap();

      expect(archQueue.add).not.toHaveBeenCalled();
      expect(prisma.generatedDoc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DocStatus.FAILED }),
        }),
      );
    });
  });
});
