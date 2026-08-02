import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DocStatus, RepositoryStatus } from '@prisma/client';
import { RepositoriesService } from './repositories.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RepositoriesService', () => {
  let service: RepositoriesService;
  let prisma: PrismaService;

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    generatedDoc: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<RepositoriesService>(RepositoriesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('importRepository', () => {
    const dto = {
      githubRepoId: '123456',
      name: 'test-repo',
      owner: 'test-owner',
      defaultBranch: 'main',
      isPrivate: false,
      cloneUrl: 'https://github.com/test-owner/test-repo.git',
    };

    it('should successfully import a repository if it does not exist', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);
      mockPrisma.repository.create.mockResolvedValue({
        id: 'uuid-123',
        userId: 'user-123',
        ...dto,
        status: RepositoryStatus.IMPORTED,
      });

      const result = await service.importRepository('user-123', dto);

      expect(result).toBeDefined();
      expect(result.id).toBe('uuid-123');
      expect(mockPrisma.repository.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.repository.create).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException if the repository is already imported (app-level check)', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(service.importRepository('user-123', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.repository.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if DB unique constraint is violated (P2002 error code)', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);
      const prismaError = new Error('Unique constraint failed');
      (prismaError as any).code = 'P2002';
      mockPrisma.repository.create.mockRejectedValue(prismaError);

      await expect(service.importRepository('user-123', dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('listImported', () => {
    it('should return a list of imported repositories', async () => {
      const mockList = [{ id: '1' }, { id: '2' }];
      mockPrisma.repository.findMany.mockResolvedValue(mockList);

      const result = await service.listImported('user-123');
      expect(result).toEqual(mockList);
      expect(mockPrisma.repository.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getImportedById', () => {
    it('should return repository details if found and owner matches', async () => {
      const mockRepo = { id: 'repo-123', userId: 'user-123', name: 'test' };
      mockPrisma.repository.findFirst.mockResolvedValue(mockRepo);

      const result = await service.getImportedById('user-123', 'repo-123');
      expect(result).toEqual(mockRepo);
    });

    it('should throw NotFoundException if repository not found or not owned', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await expect(
        service.getImportedById('user-123', 'repo-123'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteImported', () => {
    it('should delete and return id if repository exists', async () => {
      const mockRepo = { id: 'repo-123', userId: 'user-123' };
      mockPrisma.repository.findFirst.mockResolvedValue(mockRepo);
      mockPrisma.repository.delete.mockResolvedValue(mockRepo);

      const result = await service.deleteImported('user-123', 'repo-123');
      expect(result).toEqual({ id: 'repo-123' });
      expect(mockPrisma.repository.delete).toHaveBeenCalledWith({
        where: { id: 'repo-123' },
      });
    });

    it('should throw NotFoundException if repository to delete is not found', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteImported('user-123', 'repo-123'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('getArchitectureDocStatus', () => {
    it('should mark repositories without a completed doc', async () => {
      mockPrisma.repository.findMany.mockResolvedValue([
        { id: 'repo-1' },
        { id: 'repo-2' },
      ]);
      mockPrisma.generatedDoc.findMany.mockResolvedValue([]);

      const result = await service.getArchitectureDocStatus('user-123');

      expect(result).toEqual([
        {
          repositoryId: 'repo-1',
          hasDoc: false,
          version: null,
          commitSha: null,
        },
        {
          repositoryId: 'repo-2',
          hasDoc: false,
          version: null,
          commitSha: null,
        },
      ]);
      expect(mockPrisma.generatedDoc.findMany).toHaveBeenCalledWith({
        where: {
          repositoryId: { in: ['repo-1', 'repo-2'] },
          status: DocStatus.COMPLETED,
        },
        orderBy: { version: 'desc' },
        select: {
          repositoryId: true,
          version: true,
          commitSha: true,
        },
      });
    });

    it('should pick the highest completed version per repository', async () => {
      mockPrisma.repository.findMany.mockResolvedValue([
        { id: 'repo-1' },
        { id: 'repo-2' },
      ]);
      mockPrisma.generatedDoc.findMany.mockResolvedValue([
        { repositoryId: 'repo-1', version: 2, commitSha: 'bbb' },
        { repositoryId: 'repo-1', version: 1, commitSha: 'aaa' },
        { repositoryId: 'repo-2', version: 1, commitSha: 'ccc' },
      ]);

      const result = await service.getArchitectureDocStatus('user-123');

      expect(result).toEqual([
        {
          repositoryId: 'repo-1',
          hasDoc: true,
          version: 2,
          commitSha: 'bbb',
        },
        {
          repositoryId: 'repo-2',
          hasDoc: true,
          version: 1,
          commitSha: 'ccc',
        },
      ]);
    });
  });
});
