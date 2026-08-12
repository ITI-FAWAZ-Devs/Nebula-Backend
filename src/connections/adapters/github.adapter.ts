import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import {
  IProviderAdapter,
  ValidatedTokenResult,
  RemoteRepository,
} from '../interfaces/provider-adapter.interface';

@Injectable()
export class GithubAdapter implements IProviderAdapter {
  readonly provider = ConnectionProvider.GITHUB;
  private readonly logger = new Logger(GithubAdapter.name);

  async validateToken(rawToken: string): Promise<ValidatedTokenResult> {
    const response = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${rawToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Nebula-Backend',
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody?.message || 'GitHub token validation failed';
      this.logger.warn(
        `GitHub token validation failed: ${response.status} ${message}`,
      );
      throw new BadRequestException(
        'Invalid GitHub token. Please check it and try again.',
      );
    }

    const userData = (await response.json().catch(() => ({}))) as {
      login?: string;
    };
    const scopeHeader = response.headers.get('x-oauth-scopes') || '';
    const scopes = scopeHeader
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!scopes.includes('repo')) {
      throw new BadRequestException(
        'The token must have the "repo" scope. Please generate a new token with the correct permissions.',
      );
    }

    return {
      valid: true,
      scopes,
      lastValidatedAt: new Date(),
      providerUsername: userData.login,
    };
  }

  async fetchUserRepositories(rawToken: string): Promise<RemoteRepository[]> {
    const allRepos: RemoteRepository[] = [];
    let page = 1;
    const perPage = 100;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${rawToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Nebula-Backend',
          },
        },
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          errorBody?.message || 'Failed to fetch repositories from GitHub';
        if (response.status === 401) {
          throw new UnauthorizedException(
            'GitHub token has expired or is invalid.',
          );
        }
        throw new HttpException(
          `GitHub API error: ${errorMessage}`,
          response.status || HttpStatus.BAD_GATEWAY,
        );
      }

      const reposData = (await response.json()) as any[];
      if (!Array.isArray(reposData)) break;

      const mapped = reposData.map((repo) => ({
        providerRepoId: String(repo.id),
        name: repo.name,
        owner: repo.owner?.login || '',
        defaultBranch: repo.default_branch || 'main',
        isPrivate: repo.private === true,
        cloneUrl: repo.clone_url,
      }));

      allRepos.push(...mapped);

      const linkHeader = response.headers.get('link');
      const hasNextLink = linkHeader ? linkHeader.includes('rel="next"') : false;
      if (hasNextLink && reposData.length === perPage) {
        page++;
      } else {
        hasNextPage = false;
      }
    }

    return allRepos;
  }

  async getLatestCommitSha(
    rawToken: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const url = `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${rawToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Nebula-Backend',
      },
    });

    if (!response.ok) {
      if (response.status === 401)
        throw new UnauthorizedException('GitHub token expired or invalid.');
      if (response.status === 404)
        throw new BadRequestException(
          `Repository ${owner}/${repo} or branch ${branch} not found`,
        );
      throw new HttpException(
        'GitHub API error',
        response.status || HttpStatus.BAD_GATEWAY,
      );
    }

    const commit = (await response.json()) as { sha?: string };
    if (!commit.sha)
      throw new HttpException(
        'GitHub API returned no commit SHA',
        HttpStatus.BAD_GATEWAY,
      );
    return commit.sha;
  }

  async fetchRepoMetadata(
    owner: string,
    repo: string,
    rawToken?: string,
  ): Promise<RemoteRepository> {
    const url = `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Nebula-Backend',
    };

    if (rawToken) {
      headers.Authorization = `Bearer ${rawToken}`;
    }

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      if (response.status === 404) {
        throw new NotFoundException(
          `Repository "${owner}/${repo}" was not found on GitHub.`,
        );
      }
      if (response.status === 401) {
        throw new UnauthorizedException(
          'GitHub token is invalid or expired for accessing this repository.',
        );
      }
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody?.message || 'Failed to fetch repository metadata';
      throw new HttpException(
        `GitHub API error: ${message}`,
        response.status || HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await response.json()) as any;
    return {
      providerRepoId: String(data.id),
      name: data.name,
      owner: data.owner?.login || owner,
      defaultBranch: data.default_branch || 'main',
      isPrivate: data.private === true,
      cloneUrl: data.clone_url || `https://github.com/${owner}/${repo}.git`,
    };
  }
}
