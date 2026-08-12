import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DocStatus, RepositoryStatus } from '@prisma/client';
import { ArchitectureDocService } from './architecture-doc.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { GithubClientService } from '../repositories/github-client.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { ARCHITECTURE_DRAFT_QUEUE } from './architecture-doc.constants';

describe('ArchitectureDocService', () => {
  let service: ArchitectureDocService;

  const userId = 'user-1';
  const otherUserId = 'user-2';
  const repositoryId = 'repo-1';
  const indexedCommit = 'abc123';

  const readyRepository = {
    id: repositoryId,
    userId,
    status: RepositoryStatus.READY,
    lastIndexedCommit: indexedCommit,
    owner: 'owner-1',
    name: 'repo-1',
    defaultBranch: 'main',
  };

  const mockQueue = {
    add: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) =>
      key === 'aiProvider.bedrockLlmModelStrong'
        ? 'anthropic.claude-sonnet-4-6'
        : undefined,
    ),
  };

  const mockPrisma = {
    repository: {
      findFirst: jest.fn(),
    },
    generatedDoc: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockProgress = {
    publishArchDoc: jest.fn(),
  };

  const mockGithubClient = {
    getLatestCommitSha: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchitectureDocService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: getQueueToken(ARCHITECTURE_DRAFT_QUEUE),
          useValue: mockQueue,
        },
        { provide: ProgressEventsService, useValue: mockProgress },
        { provide: GithubClientService, useValue: mockGithubClient },
        {
          provide: SubscriptionService,
          useValue: { checkAndIncrementQuota: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<ArchitectureDocService>(ArchitectureDocService);
    jest.clearAllMocks();
    mockPrisma.repository.findFirst.mockResolvedValue(readyRepository);
  });

  describe('start', () => {
    it('should reject when repository is not found', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await expect(service.start(userId, repositoryId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject when user does not own the repository', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        ...readyRepository,
        userId: otherUserId,
      });

      await expect(service.start(userId, repositoryId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject when repository is not ready', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        ...readyRepository,
        status: RepositoryStatus.INDEXING,
      });

      await expect(service.start(userId, repositoryId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should accept omitted commitSha', async () => {
      const createdDoc = {
        id: 'doc-1',
        version: 1,
        status: DocStatus.PENDING,
      };

      mockPrisma.generatedDoc.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) =>
        callback({
          generatedDoc: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdDoc),
          },
        }),
      );
      mockQueue.add.mockResolvedValue({ id: createdDoc.id });

      const result = await service.start(userId, repositoryId);

      expect(result).toEqual({
        docId: 'doc-1',
        jobId: 'doc-1',
        version: 1,
        status: DocStatus.PENDING,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'draft',
        {
          repositoryId,
          documentId: 'doc-1',
          userId,
        },
        expect.objectContaining({ jobId: 'doc-1' }),
      );
    });

    it('should accept current indexed commit', async () => {
      const createdDoc = {
        id: 'doc-1',
        version: 1,
        status: DocStatus.PENDING,
      };

      mockPrisma.generatedDoc.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) =>
        callback({
          generatedDoc: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdDoc),
          },
        }),
      );
      mockQueue.add.mockResolvedValue({ id: createdDoc.id });

      await service.start(userId, repositoryId, {
        commitSha: indexedCommit,
      });

      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should reject invalid commitSha', async () => {
      await expect(
        service.start(userId, repositoryId, { commitSha: 'wrong-commit' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reuse an active document instead of creating a new version', async () => {
      const activeDoc = {
        id: 'doc-active',
        version: 2,
        status: DocStatus.GENERATING,
      };

      mockPrisma.generatedDoc.findFirst.mockResolvedValue(activeDoc);

      const result = await service.start(userId, repositoryId);

      expect(result).toEqual({
        docId: 'doc-active',
        jobId: 'doc-active',
        version: 2,
        status: DocStatus.GENERATING,
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should use document id as queue job id', async () => {
      const createdDoc = {
        id: 'doc-queue-id',
        version: 1,
        status: DocStatus.PENDING,
      };

      mockPrisma.generatedDoc.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) =>
        callback({
          generatedDoc: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdDoc),
          },
        }),
      );
      mockQueue.add.mockResolvedValue({ id: createdDoc.id });

      await service.start(userId, repositoryId);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'draft',
        expect.any(Object),
        expect.objectContaining({ jobId: 'doc-queue-id' }),
      );
    });

    it('should mark a newly created document failed when queueing fails', async () => {
      const createdDoc = {
        id: 'doc-fail',
        version: 1,
        status: DocStatus.PENDING,
      };

      mockPrisma.generatedDoc.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) =>
        callback({
          generatedDoc: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdDoc),
          },
        }),
      );
      mockQueue.add.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.start(userId, repositoryId)).rejects.toThrow(
        'Redis unavailable',
      );

      expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
        where: { id: 'doc-fail' },
        data: {
          status: DocStatus.FAILED,
          errorMessage: 'Redis unavailable',
        },
      });
    });
  });

  describe('regenerate', () => {
    it('should reject when repository is not found', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await expect(service.regenerate(userId, repositoryId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject when user does not own the repository', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        ...readyRepository,
        userId: otherUserId,
      });

      await expect(service.regenerate(userId, repositoryId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject when repository is not ready', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        ...readyRepository,
        status: RepositoryStatus.INDEXING,
      });

      await expect(service.regenerate(userId, repositoryId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reuse an active document instead of creating a new version', async () => {
      const activeDoc = {
        id: 'doc-active',
        version: 2,
        status: DocStatus.GENERATING,
      };
      mockPrisma.generatedDoc.findFirst.mockResolvedValue(activeDoc);

      const result = await service.regenerate(userId, repositoryId);

      expect(result).toEqual({
        needsRegeneration: true,
        docId: 'doc-active',
        jobId: 'doc-active',
        version: 2,
        status: DocStatus.GENERATING,
      });
      expect(mockGithubClient.getLatestCommitSha).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should reject when no completed document exists', async () => {
      mockPrisma.generatedDoc.findFirst.mockResolvedValue(null);

      await expect(service.regenerate(userId, repositoryId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should report no changes when the current commit matches the latest document', async () => {
      mockPrisma.generatedDoc.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ version: 2, commitSha: 'abc123' });
      mockGithubClient.getLatestCommitSha.mockResolvedValue('abc123');

      const result = await service.regenerate(userId, repositoryId);

      expect(mockGithubClient.getLatestCommitSha).toHaveBeenCalledWith(
        userId,
        'owner-1',
        'repo-1',
        'main',
      );
      expect(result).toEqual({
        needsRegeneration: false,
        currentCommitSha: 'abc123',
        latestVersion: 2,
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create a new version with the fetched commit when commits differ', async () => {
      const createdDoc = {
        id: 'doc-3',
        version: 3,
        status: DocStatus.PENDING,
      };

      mockPrisma.generatedDoc.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ version: 2, commitSha: 'abc123' });
      mockGithubClient.getLatestCommitSha.mockResolvedValue('newcommit');
      mockPrisma.$transaction.mockImplementation(async (callback) =>
        callback({
          generatedDoc: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdDoc),
          },
        }),
      );
      mockQueue.add.mockResolvedValue({ id: createdDoc.id });

      const result = await service.regenerate(userId, repositoryId);

      expect(mockGithubClient.getLatestCommitSha).toHaveBeenCalledWith(
        userId,
        'owner-1',
        'repo-1',
        'main',
      );
      expect(result).toEqual({
        needsRegeneration: true,
        docId: 'doc-3',
        jobId: 'doc-3',
        version: 3,
        status: DocStatus.PENDING,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'draft',
        {
          repositoryId,
          documentId: 'doc-3',
          userId,
        },
        expect.objectContaining({ jobId: 'doc-3' }),
      );
    });
  });

  describe('getLatestCompleted', () => {
    it('should return latest completed document with ordered sections', async () => {
      mockPrisma.generatedDoc.findFirst.mockResolvedValue({
        id: 'doc-1',
        version: 2,
        status: DocStatus.COMPLETED,
        commitSha: indexedCommit,
        generatedAt: new Date('2026-07-26T10:00:00.000Z'),
        verificationScore: 1,
        sections: [
          {
            key: 'overview',
            title: 'Overview',
            order: 0,
            contentMd: '# Overview',
            sourceFiles: ['src/main.ts'],
            diagramMermaid: 'flowchart TD',
            verified: true,
            verificationNotes: null,
          },
        ],
      });

      const result = await service.getLatestCompleted(userId, repositoryId);

      expect(result.docId).toBe('doc-1');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].diagramMermaid).toBe('flowchart TD');
    });

    it('should reject non-owner access', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue({
        ...readyRepository,
        userId: otherUserId,
      });

      await expect(
        service.getLatestCompleted(userId, repositoryId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getJob', () => {
    it('should return job status for owned repository document', async () => {
      mockPrisma.generatedDoc.findFirst.mockResolvedValue({
        id: 'doc-1',
        repositoryId,
        status: DocStatus.GENERATING,
        errorMessage: null,
      });

      const result = await service.getJob(userId, repositoryId, 'doc-1');

      expect(result).toEqual({
        jobId: 'doc-1',
        docId: 'doc-1',
        status: DocStatus.GENERATING,
        errorMessage: null,
      });
    });

    it('should reject when job does not belong to repository', async () => {
      mockPrisma.generatedDoc.findFirst.mockResolvedValue(null);

      await expect(
        service.getJob(userId, repositoryId, 'missing-doc'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listVersions', () => {
    it('should return versions newest first', async () => {
      mockPrisma.generatedDoc.findMany.mockResolvedValue([
        {
          id: 'doc-2',
          version: 2,
          status: DocStatus.COMPLETED,
          generatedAt: new Date('2026-07-27T10:00:00.000Z'),
          verificationScore: 0.9,
        },
        {
          id: 'doc-1',
          version: 1,
          status: DocStatus.COMPLETED,
          generatedAt: new Date('2026-07-26T10:00:00.000Z'),
          verificationScore: 1,
        },
      ]);

      const result = await service.listVersions(userId, repositoryId);

      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(2);
      expect(result[1].version).toBe(1);
    });
  });

  describe('getVersion', () => {
    it('should return completed version with sections', async () => {
      mockPrisma.generatedDoc.findFirst.mockResolvedValue({
        id: 'doc-1',
        version: 1,
        status: DocStatus.COMPLETED,
        commitSha: indexedCommit,
        generatedAt: new Date('2026-07-26T10:00:00.000Z'),
        verificationScore: 1,
        sections: [],
      });

      const result = await service.getVersion(userId, repositoryId, 1);

      expect(result.version).toBe(1);
      expect(result.status).toBe(DocStatus.COMPLETED);
    });

    it('should return non-completed version without publishable sections', async () => {
      mockPrisma.generatedDoc.findFirst.mockResolvedValue({
        id: 'doc-1',
        version: 1,
        status: DocStatus.FAILED,
        commitSha: indexedCommit,
        generatedAt: null,
        verificationScore: null,
        sections: [
          {
            key: 'should-not-publish',
            title: 'Hidden',
            order: 0,
            contentMd: 'secret',
            sourceFiles: [],
            diagramMermaid: null,
            verified: false,
            verificationNotes: null,
          },
        ],
      });

      const result = await service.getVersion(userId, repositoryId, 1);

      expect(result.status).toBe(DocStatus.FAILED);
      expect(result.sections).toEqual([]);
    });
  });
});
