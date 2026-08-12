import { BadRequestException } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';

export interface ParsedRepoUrl {
  provider: ConnectionProvider;
  owner: string;
  repo: string;
}

/**
 * Parses a repository URL or "owner/repo" shorthand string into provider, owner, and repo name.
 * Supported input formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - github.com/owner/repo
 * - owner/repo (defaults to GITHUB)
 * - https://gitlab.com/owner/repo
 * - https://bitbucket.org/owner/repo
 */
export function parseRepoUrl(input: string): ParsedRepoUrl {
  if (!input || typeof input !== 'string') {
    throw new BadRequestException('Repository URL or shorthand is required.');
  }

  let cleaned = input.trim();

  // Remove trailing slashes and trailing .git
  cleaned = cleaned.replace(/\/+$/, '');
  if (cleaned.endsWith('.git')) {
    cleaned = cleaned.slice(0, -4);
  }

  // Handle full URL or host-prefixed formats
  let host = '';
  let path = cleaned;

  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      const url = new URL(cleaned);
      host = url.hostname.toLowerCase();
      path = url.pathname.replace(/^\/+/, '');
    } catch {
      throw new BadRequestException(`Invalid repository URL: "${input}".`);
    }
  } else if (cleaned.includes('://')) {
    throw new BadRequestException(`Unsupported URL protocol in: "${input}".`);
  } else if (cleaned.startsWith('github.com/')) {
    host = 'github.com';
    path = cleaned.substring('github.com/'.length);
  } else if (cleaned.startsWith('gitlab.com/')) {
    host = 'gitlab.com';
    path = cleaned.substring('gitlab.com/'.length);
  } else if (cleaned.startsWith('bitbucket.org/')) {
    host = 'bitbucket.org';
    path = cleaned.substring('bitbucket.org/'.length);
  }

  // Infer provider
  let provider: ConnectionProvider = ConnectionProvider.GITHUB;
  if (host.includes('gitlab')) {
    provider = ConnectionProvider.GITLAB;
  } else if (host.includes('bitbucket')) {
    provider = ConnectionProvider.BITBUCKET;
  }

  // Split path into parts (e.g. owner/repo)
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new BadRequestException(
      `Could not parse owner and repository name from: "${input}". Expected format: "owner/repo" or a full repository URL.`,
    );
  }

  const owner = parts[0];
  const repo = parts[1];

  if (!owner || !repo) {
    throw new BadRequestException(`Invalid owner or repository name in: "${input}".`);
  }

  return { provider, owner, repo };
}
