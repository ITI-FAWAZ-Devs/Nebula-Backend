import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuthProvider, DocumentationJobStatus, UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    $transaction: jest.Mock;
    user: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    repository: { count: jest.Mock };
    organization: { count: jest.Mock };
    generatedDoc: { count: jest.Mock };
    docSection: { count: jest.Mock };
    usageLog: { count: jest.Mock };
    documentationJob: { count: jest.Mock };
  };

  const mockUserRow = {
    id: 'user-1',
    email: 'user@example.com',
    fullName: 'User One',
    avatar: null,
    role: UserRole.USER,
    isEmailVerified: true,
    subscriptionTier: 'FREE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    githubToken: null,
    _count: { repositories: 2, usageLogs: 3, accounts: 1 },
  };

  const mockAdminRow = {
    id: 'admin-1',
    email: 'admin@example.com',
    fullName: 'Admin',
    role: UserRole.ADMIN,
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((arg) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      repository: { count: jest.fn() },
      organization: { count: jest.fn() },
      generatedDoc: { count: jest.fn() },
      docSection: { count: jest.fn() },
      usageLog: { count: jest.fn() },
      documentationJob: { count: jest.fn() },
    };

    service = new AdminService(prisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('should return paginated users with safe summary fields', async () => {
      prisma.user.findMany.mockResolvedValue([mockUserRow]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, pageSize: 20 });

      expect(result.items).toEqual([
        {
          id: 'user-1',
          email: 'user@example.com',
          fullName: 'User One',
          avatar: null,
          role: UserRole.USER,
          isEmailVerified: true,
          subscriptionTier: 'FREE',
          githubConnected: true,
          repositoriesCount: 2,
          usageLogsCount: 3,
          createdAt: mockUserRow.createdAt,
          updatedAt: mockUserRow.updatedAt,
        },
      ]);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should mark githubConnected false when no github account or token', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          ...mockUserRow,
          githubToken: null,
          _count: { repositories: 0, usageLogs: 0, accounts: 0 },
        },
      ]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, pageSize: 20 });

      expect(result.items[0].githubConnected).toBe(false);
    });

    it('should search by email or fullName when search is provided', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ search: 'admin' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { email: { contains: 'admin', mode: 'insensitive' } },
              { fullName: { contains: 'admin', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should filter by role when provided', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ role: UserRole.ADMIN });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: UserRole.ADMIN },
        }),
      );
    });

    it('should clamp pageSize to 100', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ pageSize: 500 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getUserById', () => {
    it('should return aggregated user details without sensitive fields', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUserRow,
        currentPeriodStart: new Date('2024-01-01'),
        currentPeriodEnd: null,
        totalGenerationsUsed: 10,
        generationsUsedThisPeriod: 2,
        githubToken: null,
        accounts: [
          {
            provider: AuthProvider.GITHUB,
            providerUsername: 'userone',
            providerAvatar: 'https://avatar',
            createdAt: new Date('2024-01-01'),
          },
        ],
        usageLogs: [{ createdAt: new Date('2024-05-01') }],
        _count: {
          repositories: 2,
          usageLogs: 3,
          memberships: 1,
          ownedOrganizations: 1,
          accounts: 1,
        },
      });

      const result = await service.getUserById('user-1');

      expect(result.id).toBe('user-1');
      expect(result.repositoriesCount).toBe(2);
      expect(result.organizationsCount).toBe(1);
      expect(result.ownedOrganizationsCount).toBe(1);
      expect(result.lastUsageAt).toEqual(new Date('2024-05-01'));
      expect(result.accounts).toEqual([
        {
          provider: AuthProvider.GITHUB,
          providerUsername: 'userone',
          providerAvatar: 'https://avatar',
          createdAt: new Date('2024-01-01'),
        },
      ]);
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).not.toHaveProperty('accessToken');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteUser', () => {
    it('should delete a user with no owned data', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: UserRole.USER,
      });
      prisma.repository.count.mockResolvedValue(0);
      prisma.organization.count.mockResolvedValue(0);
      prisma.user.delete.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.deleteUser('user-1', 'admin-1'),
      ).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteUser('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('should block self-deletion', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: UserRole.ADMIN,
      });

      await expect(service.deleteUser('admin-1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('should block deleting the last admin', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      prisma.user.count.mockResolvedValue(0);

      await expect(service.deleteUser('admin-1', 'admin-2')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('should allow deleting an admin when other admins exist', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      prisma.user.count.mockResolvedValue(1);
      prisma.repository.count.mockResolvedValue(0);
      prisma.organization.count.mockResolvedValue(0);
      prisma.user.delete.mockResolvedValue({ id: 'admin-1' });

      await expect(
        service.deleteUser('admin-1', 'admin-2'),
      ).resolves.toBeUndefined();
    });

    it('should block deletion when the user owns repositories', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: UserRole.USER,
      });
      prisma.repository.count.mockResolvedValue(2);
      prisma.organization.count.mockResolvedValue(0);

      await expect(service.deleteUser('user-1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('should block deletion when the user owns organizations', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: UserRole.USER,
      });
      prisma.repository.count.mockResolvedValue(0);
      prisma.organization.count.mockResolvedValue(1);

      await expect(service.deleteUser('user-1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return platform counts', async () => {
      prisma.user.count.mockResolvedValue(10);
      prisma.repository.count.mockResolvedValue(5);
      prisma.generatedDoc.count.mockResolvedValue(3);
      prisma.docSection.count.mockResolvedValue(40);
      prisma.usageLog.count.mockResolvedValue(2);

      const result = await service.getStats();

      expect(result).toEqual({
        users: 10,
        repositories: 5,
        generatedDocs: 3,
        docSections: 40,
        usageLogs: 2,
      });
    });
  });

  describe('getDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      prisma.user.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
      prisma.repository.count.mockResolvedValue(4);
      prisma.documentationJob.count
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(1);

      const result = await service.getDashboardStats();

      expect(result).toEqual({
        totalUsers: 10,
        activeUsers: 7,
        totalImportedRepositories: 4,
        totalDocumentationJobs: 6,
        successfulDocumentationJobs: 4,
        failedDocumentationJobs: 1,
      });
    });

    it('should filter documentation jobs by status', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.repository.count.mockResolvedValue(0);
      prisma.documentationJob.count.mockResolvedValue(0);

      await service.getDashboardStats();

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { isEmailVerified: true },
      });
      expect(prisma.documentationJob.count).toHaveBeenCalledWith({
        where: { status: DocumentationJobStatus.COMPLETED },
      });
      expect(prisma.documentationJob.count).toHaveBeenCalledWith({
        where: { status: DocumentationJobStatus.FAILED },
      });
    });

    it('should return zeros when the database is empty', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.repository.count.mockResolvedValue(0);
      prisma.documentationJob.count.mockResolvedValue(0);

      const result = await service.getDashboardStats();

      expect(result).toEqual({
        totalUsers: 0,
        activeUsers: 0,
        totalImportedRepositories: 0,
        totalDocumentationJobs: 0,
        successfulDocumentationJobs: 0,
        failedDocumentationJobs: 0,
      });
    });
  });

  describe('updateUserRole', () => {
    it('should update the user role', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue({
        ...mockAdminRow,
        role: UserRole.ADMIN,
      });

      const result = await service.updateUserRole('user-1', UserRole.ADMIN);

      expect(result.role).toBe(UserRole.ADMIN);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: UserRole.ADMIN },
        select: expect.anything(),
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUserRole('missing', UserRole.ADMIN),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
