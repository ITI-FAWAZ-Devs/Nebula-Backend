import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import { UsersService } from '../users/users.service';
import { CloneRepositoryResult } from './interfaces/clone-repository-result.interface';

export interface CloneOptions {
  userId: string;
  repositoryId: string;
  cloneUrl: string;
  destPath: string;
  branch: string;
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(private readonly usersService: UsersService) {}

  async clone(options: CloneOptions): Promise<CloneRepositoryResult> {
    const { userId, repositoryId, cloneUrl, destPath, branch } = options;

    const account = await this.usersService.findAccountByUserAndProvider(
      userId,
      AuthProvider.GITHUB,
    );
    if (!account?.accessToken) {
      throw new BadRequestException(
        'GitHub account not linked. Please connect your GitHub account.',
      );
    }

    const authenticatedUrl = this.buildAuthenticatedUrl(
      cloneUrl,
      account.accessToken,
    );

    this.logger.log(`Cloning ${cloneUrl} into ${destPath} (branch: ${branch})`);

    // Dest path should be empty for clone — remove placeholder dir if present
    await fs.rm(destPath, { recursive: true, force: true });

    const git: SimpleGit = simpleGit();
    await git.clone(authenticatedUrl, destPath, [
      '--branch',
      branch,
      '--single-branch',
      '--depth',
      '1',
    ]);

    const repoGit = simpleGit(destPath);
    const commitHash = (await repoGit.revparse(['HEAD'])).trim();

    this.logger.log(`Cloned at ${commitHash}`);

    return {
      repositoryId,
      localPath: destPath,
      branch,
      commitHash,
    };
  }

  async checkout(repoPath: string, ref: string): Promise<void> {
    const git = simpleGit(repoPath);
    await git.checkout(ref);
  }

  async fetch(repoPath: string): Promise<void> {
    const git = simpleGit(repoPath);
    await git.fetch();
  }

  async delete(repoPath: string): Promise<void> {
    await fs.rm(repoPath, { recursive: true, force: true });
    this.logger.log(`Deleted local repo at ${repoPath}`);
  }

  private buildAuthenticatedUrl(cloneUrl: string, token: string): string {
    // https://github.com/owner/repo.git -> https://x-access-token:TOKEN@github.com/owner/repo.git
    try {
      const url = new URL(cloneUrl);
      url.username = 'x-access-token';
      url.password = token;
      return url.toString();
    } catch {
      return cloneUrl;
    }
  }
}
