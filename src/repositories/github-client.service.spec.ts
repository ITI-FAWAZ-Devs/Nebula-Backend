import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GithubClientService } from './github-client.service';
import { ConnectionsService } from '../connections/connections.service';
import { GithubAdapter } from '../connections/adapters/github.adapter';

describe('GithubClientService', () => {
  let service: GithubClientService;

  const mockConnectionsService = {
    fetchRemoteRepositories: jest.fn(),
    findDefaultUserConnection: jest.fn(),
    getConnectionById: jest.fn(),
    getDecryptedToken: jest.fn(),
  };

  const mockGithubAdapter = {
    getLatestCommitSha: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubClientService,
        {
          provide: ConnectionsService,
          useValue: mockConnectionsService,
        },
        {
          provide: GithubAdapter,
          useValue: mockGithubAdapter,
        },
      ],
    }).compile();

    service = module.get<GithubClientService>(GithubClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRepositories', () => {
    it('should fetch remote repositories using ConnectionsService', async () => {
      mockConnectionsService.fetchRemoteRepositories.mockResolvedValue([
        {
          providerRepoId: '111',
          name: 'repo-1',
          owner: 'owner-1',
          defaultBranch: 'main',
          isPrivate: false,
          cloneUrl: 'https://github.com/owner-1/repo-1.git',
        },
      ]);

      const result = await service.getRepositories('user-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        githubRepoId: '111',
        name: 'repo-1',
        owner: 'owner-1',
        defaultBranch: 'main',
        isPrivate: false,
        cloneUrl: 'https://github.com/owner-1/repo-1.git',
      });
      expect(mockConnectionsService.fetchRemoteRepositories).toHaveBeenCalledWith(
        'user-123',
        undefined,
        'GITHUB',
        undefined,
      );
    });

    it('should throw BadRequestException if no active connection exists', async () => {
      mockConnectionsService.fetchRemoteRepositories.mockRejectedValue(
        new BadRequestException('No active GITHUB connection found.'),
      );

      await expect(service.getRepositories('user-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getLatestCommitSha', () => {
    it('should return latest commit sha via adapter', async () => {
      mockConnectionsService.findDefaultUserConnection.mockResolvedValue({
        id: 'conn-1',
      });
      mockConnectionsService.getDecryptedToken.mockResolvedValue('raw-token');
      mockGithubAdapter.getLatestCommitSha.mockResolvedValue('sha-123');

      const sha = await service.getLatestCommitSha(
        'user-123',
        'owner-1',
        'repo-1',
        'main',
      );

      expect(sha).toBe('sha-123');
      expect(mockGithubAdapter.getLatestCommitSha).toHaveBeenCalledWith(
        'raw-token',
        'owner-1',
        'repo-1',
        'main',
      );
    });
  });
});
