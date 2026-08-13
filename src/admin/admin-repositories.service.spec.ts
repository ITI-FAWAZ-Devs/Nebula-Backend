import { ConflictException, NotFoundException } from '@nestjs/common';
import { DocStatus, RepositoryStatus } from '@prisma/client';
import { AdminRepositoriesService } from './admin-repositories.service';
import { ChromaService } from '../chroma/chroma.service';
import { GitService } from '../git/git.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { ArchitectureDocService } from '../architecture-doc/architecture-doc.service';
import {
  AdminRepositorySortBy,
  AdminRepositorySortOrder,
} from './dto/admin-list-repositories-query.dto';

describe('AdminRepositoriesService', () => {
  let service: AdminRepositoriesService;

  const prisma = {
    $transaction: jest.fn((arg) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
    repository: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    usageLog: {
      groupBy: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    documentationJob: { count: jest.fn() },
    analysisJob: { count: jest.fn() },
    generatedDoc: { count: jest.fn() },
  };

  const chroma = {
    deleteCollectionsByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  const git = {
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const neo4j = {
    deleteGraph: jest.fn().mockResolvedValue(undefined),
  };

  const architectureDocService = {
    regenerateForAdmin: jest.fn(),
  };

  const repoRow = {
    id: 'repo-1',
    githubRepoId: 'github-1',
    name: 'nebula',
    owner: 'ayman',
    defaultBranch: 'main',
    isPrivate: false,
    cloneUrl: 'https://github.com/ayman/nebula.git',
    localPath: '/tmp/nebula',
    status: RepositoryStatus.READY,
    lastIndexedCommit: 'abc123',
    lastDocumentedAt: new Date('2024-02-01'),
    documentedCommit: 'abc123',
    userId: 'user-1',
    organizationId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    user: {
      id: 'user-1',
      email: 'user@example.com',
      fullName: 'User One',
      avatar: null,
    },
    organization: null,
    generatedDocs: [
      {
        id: 'doc-1',
        version: 2,
        status: DocStatus.COMPLETED,
        generatedAt: new Date('2024-02-02'),
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminRepositoriesService(
      prisma,
      chroma as unknown as ChromaService,
      git as unknown as GitService,
      neo4j as unknown as Neo4jService,
      architectureDocService as unknown as ArchitectureDocService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listRepositories', () => {
    it('should return paginated summaries with derived status and counts', async () => {
      prisma.repository.findMany.mockResolvedValue([repoRow]);
      prisma.repository.count.mockResolvedValue(1);
      prisma.usageLog.groupBy
        .mockResolvedValueOnce([
          { repositoryId: 'repo-1', _count: { repositoryId: 4 } },
        ])
        .mockResolvedValueOnce([
          { repositoryId: 'repo-1', _count: { repositoryId: 1 } },
        ]);

      const result = await service.listRepositories({});

      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'repo-1',
          name: 'nebula',
          githubUrl: 'https://github.com/ayman/nebula',
          owner: 'ayman',
          user: {
            id: 'user-1',
            email: 'user@example.com',
            fullName: 'User One',
            avatar: null,
          },
          importDate: repoRow.createdAt,
          repositoryStatus: RepositoryStatus.READY,
          documentationStatus: DocStatus.COMPLETED,
          lastDocumentationGeneration: repoRow.lastDocumentedAt,
          lastArchDocGeneratedAt: new Date('2024-02-02'),
          qaRequestsCount: 1,
          usageLogsCount: 4,
        }),
      );
      expect(prisma.repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should mark NOT_GENERATED when no documentation exists', async () => {
      prisma.repository.findMany.mockResolvedValue([
        { ...repoRow, generatedDocs: [] },
      ]);
      prisma.repository.count.mockResolvedValue(1);
      prisma.usageLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.listRepositories({});

      expect(result.items[0].documentationStatus).toBe('NOT_GENERATED');
      expect(result.items[0].lastArchDocGeneratedAt).toBeNull();
    });

    it('should search by name or owner', async () => {
      prisma.repository.findMany.mockResolvedValue([]);
      prisma.repository.count.mockResolvedValue(0);
      prisma.usageLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.listRepositories({ search: 'neb' });

      expect(prisma.repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'neb', mode: 'insensitive' } },
              { owner: { contains: 'neb', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should apply documentation status, repository status, owner and userId filters', async () => {
      prisma.repository.findMany.mockResolvedValue([]);
      prisma.repository.count.mockResolvedValue(0);
      prisma.usageLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.listRepositories({
        documentationStatus: DocStatus.FAILED,
        repositoryStatus: RepositoryStatus.IMPORTED,
        owner: 'ayman',
        userId: 'user-1',
      });

      expect(prisma.repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: RepositoryStatus.IMPORTED,
            generatedDocs: { some: { status: DocStatus.FAILED } },
            owner: { contains: 'ayman', mode: 'insensitive' },
            userId: 'user-1',
          },
        }),
      );
    });

    it('should sort by the requested field and order', async () => {
      prisma.repository.findMany.mockResolvedValue([]);
      prisma.repository.count.mockResolvedValue(0);
      prisma.usageLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.listRepositories({
        sortBy: AdminRepositorySortBy.NAME,
        sortOrder: AdminRepositorySortOrder.ASC,
      });

      expect(prisma.repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('should clamp pageSize to 100', async () => {
      prisma.repository.findMany.mockResolvedValue([]);
      prisma.repository.count.mockResolvedValue(0);
      prisma.usageLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.listRepositories({ pageSize: 500 });

      expect(prisma.repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getRepositoryById', () => {
    it('should return detailed repository information', async () => {
      prisma.repository.findUnique.mockResolvedValue({
        ...repoRow,
        documentationJobs: [
          {
            id: 'dj-1',
            status: 'COMPLETED',
            stage: 'done',
            progress: 100,
            error: null,
            startedAt: new Date('2024-02-01'),
            finishedAt: new Date('2024-02-01'),
            createdAt: new Date('2024-02-01'),
          },
        ],
        generatedDocs: [
          {
            id: 'doc-1',
            version: 2,
            status: DocStatus.COMPLETED,
            commitSha: 'abc123',
            generatedAt: new Date('2024-02-02'),
            verificationScore: 0.9,
            triggeredByUserId: 'user-1',
            createdAt: new Date('2024-02-02'),
          },
        ],
        _count: { documentationJobs: 1, analysisJobs: 2 },
      });
      prisma.usageLog.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);

      const result = await service.getRepositoryById('repo-1');

      expect(result.id).toBe('repo-1');
      expect(result.documentationStatus).toBe(DocStatus.COMPLETED);
      expect(result.latestGeneratedDoc).toEqual(
        expect.objectContaining({ version: 2, verificationScore: 0.9 }),
      );
      expect(result.latestDocumentationJob).toEqual(
        expect.objectContaining({ id: 'dj-1', progress: 100 }),
      );
      expect(result.documentationJobsCount).toBe(1);
      expect(result.analysisJobsCount).toBe(2);
      expect(result.usageLogsCount).toBe(5);
      expect(result.qaRequestsCount).toBe(1);
      expect(result).not.toHaveProperty('localPath');
      expect(result).not.toHaveProperty('cloneUrl');
    });

    it('should throw NotFoundException when the repository does not exist', async () => {
      prisma.repository.findUnique.mockResolvedValue(null);

      await expect(service.getRepositoryById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteRepository', () => {
    it('should delete the repository and clean up derived data', async () => {
      prisma.repository.findUnique.mockResolvedValue(repoRow);
      prisma.documentationJob.count.mockResolvedValue(0);
      prisma.analysisJob.count.mockResolvedValue(0);
      prisma.generatedDoc.count.mockResolvedValue(0);
      prisma.usageLog.deleteMany.mockResolvedValue({ count: 2 });
      prisma.repository.delete.mockResolvedValue({ id: 'repo-1' });

      const result = await service.deleteRepository('repo-1', 'admin-1');

      expect(result).toEqual({ id: 'repo-1', name: 'nebula' });
      expect(prisma.usageLog.deleteMany).toHaveBeenCalledWith({
        where: { repositoryId: 'repo-1' },
      });
      expect(prisma.repository.delete).toHaveBeenCalledWith({
        where: { id: 'repo-1' },
      });
      expect(chroma.deleteCollectionsByPrefix).toHaveBeenCalledWith(
        'repo-repo-1',
      );
      expect(neo4j.deleteGraph).toHaveBeenCalledWith('repo-1');
      expect(git.delete).toHaveBeenCalledWith('/tmp/nebula');
    });

    it('should throw NotFoundException when the repository does not exist', async () => {
      prisma.repository.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteRepository('missing', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.repository.delete).not.toHaveBeenCalled();
    });

    it('should throw ConflictException while documentation jobs are in flight', async () => {
      prisma.repository.findUnique.mockResolvedValue(repoRow);
      prisma.documentationJob.count.mockResolvedValue(1);
      prisma.analysisJob.count.mockResolvedValue(0);
      prisma.generatedDoc.count.mockResolvedValue(0);

      await expect(
        service.deleteRepository('repo-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.repository.delete).not.toHaveBeenCalled();
    });

    it('should throw ConflictException while analysis jobs are in flight', async () => {
      prisma.repository.findUnique.mockResolvedValue(repoRow);
      prisma.documentationJob.count.mockResolvedValue(0);
      prisma.analysisJob.count.mockResolvedValue(1);
      prisma.generatedDoc.count.mockResolvedValue(0);

      await expect(
        service.deleteRepository('repo-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.repository.delete).not.toHaveBeenCalled();
    });

    it('should throw ConflictException while documentation generations are in flight', async () => {
      prisma.repository.findUnique.mockResolvedValue(repoRow);
      prisma.documentationJob.count.mockResolvedValue(0);
      prisma.analysisJob.count.mockResolvedValue(0);
      prisma.generatedDoc.count.mockResolvedValue(1);

      await expect(
        service.deleteRepository('repo-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.repository.delete).not.toHaveBeenCalled();
    });

    it('should not fail when external cleanup fails', async () => {
      prisma.repository.findUnique.mockResolvedValue(repoRow);
      prisma.documentationJob.count.mockResolvedValue(0);
      prisma.analysisJob.count.mockResolvedValue(0);
      prisma.generatedDoc.count.mockResolvedValue(0);
      prisma.usageLog.deleteMany.mockResolvedValue({ count: 0 });
      prisma.repository.delete.mockResolvedValue({ id: 'repo-1' });
      neo4j.deleteGraph.mockRejectedValueOnce(new Error('driver down'));
      git.delete.mockRejectedValueOnce(new Error('eacces'));

      await expect(
        service.deleteRepository('repo-1', 'admin-1'),
      ).resolves.toEqual({ id: 'repo-1', name: 'nebula' });
    });
  });

  describe('regenerateDocumentation', () => {
    it('should delegate to the architecture doc service', async () => {
      architectureDocService.regenerateForAdmin.mockResolvedValue({
        needsRegeneration: true,
        docId: 'doc-1',
        jobId: 'doc-1',
        version: 3,
        status: DocStatus.PENDING,
      });

      const result = await service.regenerateDocumentation('repo-1', 'admin-1');

      expect(architectureDocService.regenerateForAdmin).toHaveBeenCalledWith(
        'repo-1',
      );
      expect(result).toEqual(
        expect.objectContaining({ needsRegeneration: true, version: 3 }),
      );
    });

    it('should propagate not-found errors', async () => {
      architectureDocService.regenerateForAdmin.mockRejectedValue(
        new NotFoundException('Repository not found'),
      );

      await expect(
        service.regenerateDocumentation('missing', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
