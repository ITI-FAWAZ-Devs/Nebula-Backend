import { Injectable, BadRequestException } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import { ConnectionsService } from '../connections/connections.service';
import { GithubAdapter } from '../connections/adapters/github.adapter';

export interface GitHubRepoDetails {
  githubRepoId: string;
  name: string;
  owner: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
  updatedAt?: string;
}

export interface GitHubRepoFilters {
  search?: string;
  visibility?: 'public' | 'private' | 'all';
  sort?: 'name' | 'updated';
}

@Injectable()
export class GithubClientService {
  private readonly cache = new Map<
    string,
    { data: GitHubRepoDetails[]; timestamp: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000;

  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly githubAdapter: GithubAdapter,
  ) {}

  async getRepositories(
    userId: string,
    forceRefresh = false,
    connectionId?: string,
    organizationId?: string,
    filters?: GitHubRepoFilters,
  ): Promise<GitHubRepoDetails[]> {
    // Raw fetch is cached without filters; filtering is applied after cache lookup
    const cacheKey = [userId, connectionId ?? 'all', organizationId ?? 'personal'].join(':');
    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return this.applyFilters(cached.data, filters);
      }
    }

    const remoteRepos = await this.connectionsService.fetchRemoteRepositories(
      userId,
      connectionId,
      ConnectionProvider.GITHUB,
      organizationId,
    );

    const mapped: GitHubRepoDetails[] = remoteRepos.map((repo) => ({
      githubRepoId: repo.providerRepoId,
      name: repo.name,
      owner: repo.owner,
      defaultBranch: repo.defaultBranch,
      isPrivate: repo.isPrivate,
      cloneUrl: repo.cloneUrl,
      updatedAt: repo.updatedAt,
    }));

    this.cache.set(cacheKey, { data: mapped, timestamp: Date.now() });
    return this.applyFilters(mapped, filters);
  }

  private applyFilters(
    repos: GitHubRepoDetails[],
    filters?: GitHubRepoFilters,
  ): GitHubRepoDetails[] {
    if (!filters) return repos;

    let result = repos;

    // Search by name (case-insensitive substring)
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }

    // Visibility filter
    if (filters.visibility && filters.visibility !== 'all') {
      const wantPrivate = filters.visibility === 'private';
      result = result.filter((r) => r.isPrivate === wantPrivate);
    }

    // Sort
    if (filters.sort === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    } else if (filters.sort === 'updated') {
      result = [...result].sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta; // most recently updated first
      });
    }

    return result;
  }

  async getLatestCommitSha(
    userId: string,
    owner: string,
    repo: string,
    branch: string,
    connectionId?: string,
  ): Promise<string> {
    const conn = connectionId
      ? await this.connectionsService.getConnectionById(connectionId, userId)
      : await this.connectionsService.findDefaultUserConnection(
          userId,
          ConnectionProvider.GITHUB,
        );

    if (!conn) {
      throw new BadRequestException('No active GitHub connection found.');
    }

    const rawToken = await this.connectionsService.getDecryptedToken(conn.id);
    return this.githubAdapter.getLatestCommitSha(
      rawToken,
      owner,
      repo,
      branch,
    );
  }
}
