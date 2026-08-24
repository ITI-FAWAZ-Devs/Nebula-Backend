import { ConnectionProvider } from '@prisma/client';

export interface ValidatedTokenResult {
  valid: boolean;
  scopes: string[];
  lastValidatedAt: Date;
  providerUsername?: string;
}

export interface RemoteRepository {
  providerRepoId: string;
  name: string;
  owner: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
  updatedAt?: string;
}

export interface IProviderAdapter {
  readonly provider: ConnectionProvider;
  validateToken(rawToken: string): Promise<ValidatedTokenResult>;
  fetchUserRepositories(rawToken: string): Promise<RemoteRepository[]>;
  fetchRepoMetadata(owner: string, repo: string, rawToken?: string): Promise<RemoteRepository>;
  getLatestCommitSha(rawToken: string, owner: string, repo: string, branch: string): Promise<string>;
}
