import { Injectable } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import { ConnectionsService } from '../connections/connections.service';
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';

@Injectable()
export class GithubTokenService {
  constructor(private readonly connectionsService: ConnectionsService) { }

  async validateAndSave(
    userId: string,
    rawToken: string,
  ): Promise<{ valid: true; scopes: string[]; lastValidatedAt: Date }> {
    const conn = await this.connectionsService.createConnection(userId, {
      provider: ConnectionProvider.GITHUB,
      label: 'GitHub PAT',
      rawToken,
    });

    return {
      valid: true,
      scopes: conn.scopes,
      lastValidatedAt: conn.lastValidatedAt,
    };
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
      const message = errorBody?.message || 'GitHub token validation failed';
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

  async getStatus(userId: string): Promise<{
    hasToken: boolean;
    scopes?: string[];
    lastValidatedAt?: Date;
  }> {
    const conn = await this.connectionsService.findDefaultUserConnection(
      userId,
      ConnectionProvider.GITHUB,
    );

    if (!conn) {
      return { hasToken: false };
    }

    return {
      hasToken: true,
      scopes: conn.scopes,
      lastValidatedAt: conn.lastValidatedAt,
    };
  }

  async remove(userId: string): Promise<void> {
    const conn = await this.connectionsService.findDefaultUserConnection(
      userId,
      ConnectionProvider.GITHUB,
    );

    if (conn) {
      await this.connectionsService.deleteConnection(conn.id, userId);
    }
  }

  async hasValidToken(userId: string): Promise<boolean> {
    const conn = await this.connectionsService.findDefaultUserConnection(
      userId,
      ConnectionProvider.GITHUB,
    );
    return !!conn;
  }

  async getDecryptedToken(userId: string): Promise<string | null> {
    const conn = await this.connectionsService.findDefaultUserConnection(
      userId,
      ConnectionProvider.GITHUB,
    );

    if (!conn) return null;
    return this.connectionsService.getDecryptedToken(conn.id);
  }
}
