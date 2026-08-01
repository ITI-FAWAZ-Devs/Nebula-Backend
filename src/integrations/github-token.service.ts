import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';

@Injectable()
export class GithubTokenService {
  private readonly logger = new Logger(GithubTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Validates a GitHub PAT against the GitHub API, checks for `repo` scope,
   * encrypts it, and stores/updates the record.
   */
  async validateAndSave(
    userId: string,
    rawToken: string,
  ): Promise<{ valid: true; scopes: string[]; lastValidatedAt: Date }> {
    // 1. Validate the token by calling GitHub /user
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
      const message =
        errorBody?.message || 'GitHub token validation failed';
      this.logger.warn(
        `GitHub token validation failed for user ${userId}: ${response.status} ${message}`,
      );
      throw new BadRequestException(
        'Invalid GitHub token. Please check it and try again.',
      );
    }

    // 2. Check scopes from the X-OAuth-Scopes header
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

    // 3. Encrypt the token
    const encryptedToken = this.encryptionService.encrypt(rawToken);

    // 4. Upsert the record
    const now = new Date();
    await this.prisma.userGithubToken.upsert({
      where: { userId },
      create: {
        userId,
        encryptedToken,
        scopes,
        lastValidatedAt: now,
      },
      update: {
        encryptedToken,
        scopes,
        lastValidatedAt: now,
      },
    });

    this.logger.log(`GitHub token saved for user ${userId}`);

    return { valid: true, scopes, lastValidatedAt: now };
  }

  /**
   * Returns whether a valid token exists and its metadata, without exposing the token.
   */
  async getStatus(userId: string): Promise<{
    hasToken: boolean;
    scopes?: string[];
    lastValidatedAt?: Date;
  }> {
    const record = await this.prisma.userGithubToken.findUnique({
      where: { userId },
      select: { scopes: true, lastValidatedAt: true },
    });

    if (!record) {
      return { hasToken: false };
    }

    return {
      hasToken: true,
      scopes: record.scopes,
      lastValidatedAt: record.lastValidatedAt,
    };
  }

  /**
   * Removes the stored GitHub token.
   */
  async remove(userId: string): Promise<void> {
    const existing = await this.prisma.userGithubToken.findUnique({
      where: { userId },
    });

    if (!existing) {
      return; // Idempotent — no token to remove
    }

    await this.prisma.userGithubToken.delete({
      where: { userId },
    });

    this.logger.log(`GitHub token removed for user ${userId}`);
  }

  /**
   * Checks whether the user has a stored GitHub token.
   * Used by the GithubTokenGuard.
   */
  async hasValidToken(userId: string): Promise<boolean> {
    const count = await this.prisma.userGithubToken.count({
      where: { userId },
    });
    return count > 0;
  }

  /**
   * Returns the decrypted raw PAT for internal use (e.g., cloning).
   * NEVER expose this via a controller/API response.
   */
  async getDecryptedToken(userId: string): Promise<string | null> {
    const record = await this.prisma.userGithubToken.findUnique({
      where: { userId },
      select: { encryptedToken: true },
    });

    if (!record) {
      return null;
    }

    return this.encryptionService.decrypt(record.encryptedToken);
  }
}
