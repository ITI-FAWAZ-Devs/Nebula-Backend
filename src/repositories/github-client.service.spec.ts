import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { GithubClientService } from './github-client.service';
import { UsersService } from '../users/users.service';

describe('GithubClientService', () => {
  let service: GithubClientService;
  let usersService: UsersService;

  const mockUsersService = {
    findAccountByUserAndProvider: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubClientService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    service = module.get<GithubClientService>(GithubClientService);
    usersService = module.get<UsersService>(UsersService);

    // Mock global fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRepositories', () => {
    it('should throw BadRequestException if GITHUB account is not linked', async () => {
      mockUsersService.findAccountByUserAndProvider.mockResolvedValue(null);

      await expect(service.getRepositories('user-123')).rejects.toThrow(
        BadRequestException,
      );
      expect(
        mockUsersService.findAccountByUserAndProvider,
      ).toHaveBeenCalledWith('user-123', AuthProvider.GITHUB);
    });

    it('should fetch and return repositories from GitHub (no pagination)', async () => {
      mockUsersService.findAccountByUserAndProvider.mockResolvedValue({
        accessToken: 'mock-token',
      });

      const mockGithubRepos = [
        {
          id: 111,
          name: 'repo-1',
          owner: { login: 'owner-1' },
          default_branch: 'main',
          private: false,
          clone_url: 'https://github.com/owner-1/repo-1.git',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn().mockReturnValue(null), // no Link header
        },
        json: jest.fn().mockResolvedValue(mockGithubRepos),
      });

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
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should loop and aggregate repositories when pagination headers indicate a next page', async () => {
      mockUsersService.findAccountByUserAndProvider.mockResolvedValue({
        accessToken: 'mock-token',
      });

      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `repo-${i}`,
        owner: { login: 'owner-1' },
        default_branch: 'main',
        private: false,
        clone_url: `https://github.com/owner-1/repo-${i}.git`,
      }));

      const page2 = [
        {
          id: 101,
          name: 'repo-101',
          owner: { login: 'owner-1' },
          default_branch: 'main',
          private: true,
          clone_url: 'https://github.com/owner-1/repo-101.git',
        },
      ];

      // Mock fetch responses for page 1 and page 2
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: jest
              .fn()
              .mockReturnValue(
                'Link: <https://api.github.com/...page=2>; rel="next"',
              ),
          },
          json: jest.fn().mockResolvedValue(page1),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
          json: jest.fn().mockResolvedValue(page2),
        });

      const result = await service.getRepositories('user-123', true);

      expect(result).toHaveLength(101);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result[100].isPrivate).toBe(true);
    });

    it('should utilize cache on subsequent requests unless forceRefresh is true', async () => {
      mockUsersService.findAccountByUserAndProvider.mockResolvedValue({
        accessToken: 'mock-token',
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        json: jest
          .fn()
          .mockResolvedValue([{ id: 99, owner: { login: 'owner-1' } }]),
      });

      // First call (fetches from API)
      await service.getRepositories('user-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call (uses cached value, fetch not called again)
      await service.getRepositories('user-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Third call with forceRefresh = true (bypasses cache and calls API again)
      await service.getRepositories('user-123', true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw UnauthorizedException if GitHub token is invalid (401)', async () => {
      mockUsersService.findAccountByUserAndProvider.mockResolvedValue({
        accessToken: 'invalid-token',
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        json: jest.fn().mockResolvedValue({ message: 'Bad credentials' }),
      });

      await expect(service.getRepositories('user-123', true)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw HttpException for other API errors (e.g., 403 or 500)', async () => {
      mockUsersService.findAccountByUserAndProvider.mockResolvedValue({
        accessToken: 'token',
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 403,
        json: jest.fn().mockResolvedValue({ message: 'Rate limit exceeded' }),
      });

      await expect(service.getRepositories('user-123', true)).rejects.toThrow(
        HttpException,
      );
    });
  });
});
