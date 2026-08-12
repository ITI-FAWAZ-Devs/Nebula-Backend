import { Injectable, Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import { ConnectionsService } from '../connections/connections.service';
import { CloneRepositoryResult } from './interfaces/clone-repository-result.interface';

export interface CloneOptions {
  userId: string;
  repositoryId: string;
  cloneUrl: string;
  destPath: string;
  branch: string;
  orgId?: string | null;
  connectionId?: string | null;
  token?: string;
  isPrivate?: boolean;
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(
    private readonly connectionsService: ConnectionsService,
  ) {}

  async clone(options: CloneOptions): Promise<CloneRepositoryResult> {
    const { userId, repositoryId, cloneUrl, destPath, branch, orgId, connectionId, isPrivate } = options;

    // Prefer an explicitly supplied token (e.g. for public repos the caller may pass null)
    const token =
      options.token !== undefined
        ? options.token
        : await this.connectionsService.resolveTokenForRepo({
            userId,
            orgId,
            connectionId,
            isPrivate,
          });

    const authenticatedUrl = token
      ? this.buildAuthenticatedUrl(cloneUrl, token)
      : cloneUrl;

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
