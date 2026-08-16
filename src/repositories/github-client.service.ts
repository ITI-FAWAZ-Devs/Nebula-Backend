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
  ): Promise<GitHubRepoDetails[]> {
    const cacheKey = [userId, connectionId ?? 'all', organizationId ?? 'personal'].join(':');
    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
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
    }));

    this.cache.set(cacheKey, { data: mapped, timestamp: Date.now() });
    return mapped;
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
