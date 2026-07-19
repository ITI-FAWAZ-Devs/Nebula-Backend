import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { UsersService } from '../users/users.service';

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
  // In-memory cache for listing repositories: userId -> { data, timestamp }
  private readonly cache = new Map<
    string,
    { data: GitHubRepoDetails[]; timestamp: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(private readonly usersService: UsersService) {}

  /**
   * Fetches all repositories (public and private) for the authenticated user from GitHub.
   * Leverages internal pagination to fetch all pages, and caches the results.
   */
  async getRepositories(
    userId: string,
    forceRefresh = false,
  ): Promise<GitHubRepoDetails[]> {
    // 1. Fetch user's GitHub account and token
    const account = await this.usersService.findAccountByUserAndProvider(
      userId,
      AuthProvider.GITHUB,
    );
    if (!account || !account.accessToken) {
      throw new BadRequestException(
        'GitHub account not linked. Please connect your GitHub account.',
      );
    }

    // 2. Check cache if not forcing refresh
    if (!forceRefresh) {
      const cached = this.cache.get(userId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }
    }

    const accessToken = account.accessToken;
    const allRepos: GitHubRepoDetails[] = [];
    let page = 1;
    const perPage = 100; // GitHub API maximum limit per page
    let hasNextPage = true;

    // 3. Loop through pages to retrieve all repositories
    while (hasNextPage) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
            'GitHub OAuth token has expired or is invalid. Please reconnect your account.',
          );
        }

        throw new HttpException(
          `GitHub API error: ${errorMessage}`,
          response.status || HttpStatus.BAD_GATEWAY,
        );
      }

      const reposData = (await response.json()) as any[];
      if (!Array.isArray(reposData)) {
        break;
      }

      // Map raw GitHub repositories to details interface
      const mappedPage = reposData.map((repo) => ({
        githubRepoId: String(repo.id),
        name: repo.name,
        owner: repo.owner.login,
        defaultBranch: repo.default_branch || 'main',
        isPrivate: repo.private === true,
        cloneUrl: repo.clone_url,
      }));

      allRepos.push(...mappedPage);

      // Determine if there is a next page using Link header or page array length
      const linkHeader = response.headers.get('link');
      const hasNextLink = linkHeader
        ? linkHeader.includes('rel="next"')
        : false;

      if (hasNextLink && reposData.length === perPage) {
        page++;
      } else {
        hasNextPage = false;
      }
    }

    // 4. Update Cache
    this.cache.set(userId, {
      data: allRepos,
      timestamp: Date.now(),
    });

    return allRepos;
  }
}
