import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import { ConnectionsService } from './connections.service';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
import { GithubAdapter } from './adapters/github.adapter';

describe('ConnectionsService', () => {
  let service: ConnectionsService;
  let prisma: PrismaService;
  let encryptionService: EncryptionService;
  let githubAdapter: GithubAdapter;

  const mockPrisma = {
    connection: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockEncryptionService = {
    encrypt: jest.fn((val: string) => `encrypted_${val}`),
    decrypt: jest.fn((val: string) => val.replace('encrypted_', '')),
  };

  const mockGithubAdapter = {
    provider: ConnectionProvider.GITHUB,
    validateToken: jest.fn(),
    fetchUserRepositories: jest.fn(),
    getLatestCommitSha: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: GithubAdapter, useValue: mockGithubAdapter },
      ],
    }).compile();

    service = module.get<ConnectionsService>(ConnectionsService);
    prisma = module.get<PrismaService>(PrismaService);
    encryptionService = module.get<EncryptionService>(EncryptionService);
    githubAdapter = module.get<GithubAdapter>(GithubAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createConnection', () => {
    it('should validate, encrypt, and save a connection', async () => {
      mockGithubAdapter.validateToken.mockResolvedValue({
        valid: true,
        scopes: ['repo'],
        lastValidatedAt: new Date(),
        providerUsername: 'octocat',
      });

      mockPrisma.connection.create.mockResolvedValue({
        id: 'conn-1',
        provider: ConnectionProvider.GITHUB,
        credentialType: 'PAT',
        label: 'My PAT',
        encryptedToken: 'encrypted_ghp_123',
        scopes: ['repo'],
        lastValidatedAt: new Date(),
        isValid: true,
        userId: 'user-1',
      });

      const result = await service.createConnection('user-1', {
        provider: ConnectionProvider.GITHUB,
        rawToken: 'ghp_123',
        label: 'My PAT',
      });

      expect(mockGithubAdapter.validateToken).toHaveBeenCalledWith('ghp_123');
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('ghp_123');
      expect(result.id).toBe('conn-1');
    });

    it('should throw BadRequestException if unique label constraint fails', async () => {
      mockGithubAdapter.validateToken.mockResolvedValue({
        valid: true,
        scopes: ['repo'],
        lastValidatedAt: new Date(),
      });

      const p2002Error = new Error('Unique failed');
      (p2002Error as any).code = 'P2002';
      mockPrisma.connection.create.mockRejectedValue(p2002Error);

      await expect(
        service.createConnection('user-1', {
          provider: ConnectionProvider.GITHUB,
          rawToken: 'ghp_123',
          label: 'Existing Label',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listUserConnections', () => {
    it('should return safe connections without encrypted tokens', async () => {
      mockPrisma.connection.findMany.mockResolvedValue([
        { id: 'c1', label: 'PAT 1', encryptedToken: 'secret1' },
        { id: 'c2', label: 'PAT 2', encryptedToken: 'secret2' },
      ]);

      const result = await service.listUserConnections('user-1');
      expect(result).toHaveLength(2);
      expect((result[0] as any).encryptedToken).toBeUndefined();
      expect(result[0].id).toBe('c1');
    });
  });

  describe('getDecryptedToken', () => {
    it('should return decrypted token for valid connection', async () => {
      mockPrisma.connection.findUnique.mockResolvedValue({
        encryptedToken: 'encrypted_mytoken',
        isValid: true,
      });

      const decrypted = await service.getDecryptedToken('conn-1');
      expect(decrypted).toBe('mytoken');
    });

    it('should throw BadRequestException if connection is invalid', async () => {
      mockPrisma.connection.findUnique.mockResolvedValue({
        encryptedToken: 'encrypted_mytoken',
        isValid: false,
      });

      await expect(service.getDecryptedToken('conn-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Org Connections', () => {
    it('should create an org connection', async () => {
      mockGithubAdapter.validateToken.mockResolvedValue({
        valid: true,
        scopes: ['repo'],
        lastValidatedAt: new Date(),
        providerUsername: 'orgbot',
      });

      mockPrisma.connection.create.mockResolvedValue({
        id: 'org-conn-1',
        orgId: 'org-1',
        provider: ConnectionProvider.GITHUB,
        encryptedToken: 'encrypted_token',
        isValid: true,
      });

      const result = await service.createOrgConnection('user-1', 'org-1', {
        provider: ConnectionProvider.GITHUB,
        rawToken: 'token',
      });

      expect(result.id).toBe('org-conn-1');
      expect(mockPrisma.connection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization: { connect: { id: 'org-1' } },
            createdByUser: { connect: { id: 'user-1' } },
          }),
        }),
      );
    });

    it('should list org connections without encrypted tokens', async () => {
      mockPrisma.connection.findMany.mockResolvedValue([
        { id: 'oc1', orgId: 'org-1', encryptedToken: 'secret' },
      ]);

      const result = await service.listOrgConnections('org-1');
      expect(result).toHaveLength(1);
      expect((result[0] as any).encryptedToken).toBeUndefined();
    });

    it('should delete org connection if it belongs to org', async () => {
      mockPrisma.connection.findUnique.mockResolvedValue({
        id: 'oc1',
        orgId: 'org-1',
      });
      mockPrisma.connection.delete.mockResolvedValue({});

      await service.deleteOrgConnection('oc1', 'org-1');
      expect(mockPrisma.connection.delete).toHaveBeenCalledWith({
        where: { id: 'oc1' },
      });
    });

    it('should throw NotFoundException on delete if connection belongs to different org', async () => {
      mockPrisma.connection.findUnique.mockResolvedValue({
        id: 'oc1',
        orgId: 'other-org',
      });

      await expect(service.deleteOrgConnection('oc1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveTokenForRepo', () => {
    it('should prioritize explicit connectionId', async () => {
      mockPrisma.connection.findUnique.mockResolvedValue({
        encryptedToken: 'encrypted_explicit',
        isValid: true,
      });

      const token = await service.resolveTokenForRepo({
        userId: 'user-1',
        connectionId: 'conn-explicit',
      });

      expect(token).toBe('explicit');
    });

    it('should fallback to org default connection if orgId is provided', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        encryptedToken: 'encrypted_org_default',
        isValid: true,
      });

      const token = await service.resolveTokenForRepo({
        userId: 'user-1',
        orgId: 'org-1',
      });

      expect(token).toBe('org_default');
    });

    it('should fallback to user default connection if no org connection', async () => {
      // First findFirst (for org) returns null, second (for user) returns user connection
      mockPrisma.connection.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          encryptedToken: 'encrypted_user_default',
          isValid: true,
        });

      const token = await service.resolveTokenForRepo({
        userId: 'user-1',
        orgId: 'org-1',
      });

      expect(token).toBe('user_default');
    });

    it('should throw BadRequestException if private repo and no token found', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveTokenForRepo({
          userId: 'user-1',
          isPrivate: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
