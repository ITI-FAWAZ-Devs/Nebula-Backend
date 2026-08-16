import { ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentationJobStatus } from '@prisma/client';
import { AdminDocumentationJobsService } from './admin-documentation-jobs.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { Queue } from 'bullmq';

describe('AdminDocumentationJobsService', () => {
  let service: AdminDocumentationJobsService;

  const prisma = {
    $transaction: jest.fn((arg) => Promise.all(arg)),
    documentationJob: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const progress = {
    publishDocumentation: jest.fn(),
  };

  const documentationQueue = {
    add: jest.fn(),
  };

  const jobRow = {
    id: 'dj-1',
    repositoryId: 'repo-1',
    status: DocumentationJobStatus.FAILED,
    stage: 'discovery',
    progress: 12,
    error: 'Network error',
    queueJobId: 'bull-1',
    resumeCount: 2,
    checkpoint: { completedStages: ['clone'], artifacts: { localPath: '/x' } },
    startedAt: new Date('2024-02-01T10:00:00Z'),
    finishedAt: new Date('2024-02-01T10:01:00Z'),
    createdAt: new Date('2024-02-01T10:00:00Z'),
    updatedAt: new Date('2024-02-01T10:01:00Z'),
    repository: {
      id: 'repo-1',
      name: 'nebula',
      owner: 'ayman',
      isPrivate: false,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        fullName: 'User One',
        avatar: null,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminDocumentationJobsService(
      prisma as unknown as PrismaService,
      progress as unknown as ProgressEventsService,
      documentationQueue as unknown as Queue,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listJobs', () => {
    it('should return paginated summaries with repository and user info', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([jobRow]);
      prisma.documentationJob.count.mockResolvedValue(1);

      const result = await service.listJobs({});

      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'dj-1',
          status: DocumentationJobStatus.FAILED,
          stage: 'discovery',
          progress: 12,
          error: 'Network error',
          repository: {
            id: 'repo-1',
            name: 'nebula',
            owner: 'ayman',
            githubUrl: 'https://github.com/ayman/nebula',
            isPrivate: false,
          },
          user: {
            id: 'user-1',
            email: 'user@example.com',
            fullName: 'User One',
            avatar: null,
          },
        }),
      );
      expect(result.items[0]).not.toHaveProperty('checkpoint');
      expect(result.items[0]).not.toHaveProperty('queueJobId');
      expect(prisma.documentationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should search by repository name, owner, user name or email', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([]);
      prisma.documentationJob.count.mockResolvedValue(0);

      await service.listJobs({ search: 'neb' });

      expect(prisma.documentationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              {
                repository: {
                  name: { contains: 'neb', mode: 'insensitive' },
                },
              },
              {
                repository: {
                  owner: { contains: 'neb', mode: 'insensitive' },
                },
              },
              {
                repository: {
                  user: {
                    fullName: { contains: 'neb', mode: 'insensitive' },
                  },
                },
              },
              {
                repository: {
                  user: { email: { contains: 'neb', mode: 'insensitive' } },
                },
              },
            ],
          },
        }),
      );
    });

    it('should apply the status filter', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([]);
      prisma.documentationJob.count.mockResolvedValue(0);

      await service.listJobs({ status: DocumentationJobStatus.RUNNING });

      expect(prisma.documentationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: DocumentationJobStatus.RUNNING },
        }),
      );
    });

    it('should clamp pageSize to 100', async () => {
      prisma.documentationJob.findMany.mockResolvedValue([]);
      prisma.documentationJob.count.mockResolvedValue(0);

      await service.listJobs({ pageSize: 500 });

      expect(prisma.documentationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getJobById', () => {
    it('should return detailed job information', async () => {
      prisma.documentationJob.findUnique.mockResolvedValue(jobRow);

      const result = await service.getJobById('dj-1');

      expect(result.id).toBe('dj-1');
      expect(result.queueJobId).toBe('bull-1');
      expect(result.resumeCount).toBe(2);
      expect(result.repository.name).toBe('nebula');
      expect(result).not.toHaveProperty('checkpoint');
    });

    it('should throw NotFoundException when the job does not exist', async () => {
      prisma.documentationJob.findUnique.mockResolvedValue(null);

      await expect(service.getJobById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('retryJob', () => {
    it('should re-enqueue a failed job and reset it to PENDING', async () => {
      let updateArgs: Record<string, unknown> | undefined;
      prisma.documentationJob.update.mockImplementation(
        (args: Record<string, unknown>) => {
          updateArgs = args;
          return Promise.resolve({
            ...jobRow,
            status: DocumentationJobStatus.PENDING,
            stage: 'queued',
            progress: 0,
            error: null,
            startedAt: null,
            finishedAt: null,
            queueJobId: 'bull-retry-1',
            resumeCount: 3,
          });
        },
      );
      prisma.documentationJob.findUnique.mockResolvedValue(jobRow);
      documentationQueue.add.mockResolvedValue({ id: 'bull-retry-1' });

      const result = await service.retryJob('dj-1', 'admin-1');

      expect(documentationQueue.add).toHaveBeenCalledWith(
        'document',
        {
          repositoryId: 'repo-1',
          documentationJobId: 'dj-1',
          userId: 'user-1',
        },
        expect.objectContaining({
          jobId: 'dj-1-retry-3',
          attempts: 5,
        }),
      );
      expect(prisma.documentationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'dj-1' } }),
      );
      expect(updateArgs).toMatchObject({
        where: { id: 'dj-1' },
        data: {
          status: DocumentationJobStatus.PENDING,
          stage: 'queued',
          progress: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
          queueJobId: 'bull-retry-1',
          resumeCount: 3,
        },
      });
      expect(progress.publishDocumentation).toHaveBeenCalledWith(
        'repo-1',
        expect.objectContaining({ id: 'dj-1' }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: 'dj-1',
          status: DocumentationJobStatus.PENDING,
          resumeCount: 3,
          queueJobId: 'bull-retry-1',
        }),
      );
    });

    it('should throw NotFoundException when the job does not exist', async () => {
      prisma.documentationJob.findUnique.mockResolvedValue(null);

      await expect(service.retryJob('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(documentationQueue.add).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when the job is not FAILED', async () => {
      prisma.documentationJob.findUnique.mockResolvedValue({
        ...jobRow,
        status: DocumentationJobStatus.RUNNING,
      });

      await expect(service.retryJob('dj-1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(documentationQueue.add).not.toHaveBeenCalled();
      expect(prisma.documentationJob.update).not.toHaveBeenCalled();
    });
  });
});
