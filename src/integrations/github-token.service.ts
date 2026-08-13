import { Injectable, Logger } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import { ConnectionsService } from '../connections/connections.service';

@Injectable()
export class GithubTokenService {
  private readonly logger = new Logger(GithubTokenService.name);

  constructor(private readonly connectionsService: ConnectionsService) {}

  async validateAndSave(
    userId: string,
    rawToken: string,
  ): Promise<{ valid: true; scopes: string[]; lastValidatedAt: Date }> {
    // Replace any previously saved default GitHub connection for this user
    // (keeps the upsert semantics of the legacy endpoint).
    const existing = await this.connectionsService.findDefaultUserConnection(
      userId,
      ConnectionProvider.GITHUB,
    );
    if (existing) {
      await this.connectionsService.deleteConnection(existing.id, userId);
    }

    // Validates the token against GitHub, checks the "repo" scope, encrypts it
    // and stores it as a connection.
    const connection = await this.connectionsService.createConnection(userId, {
      provider: ConnectionProvider.GITHUB,
      rawToken,
    });

    this.logger.log(`GitHub token saved for user ${userId}`);

    return {
      valid: true,
      scopes: connection.scopes,
      lastValidatedAt: connection.lastValidatedAt,
    };
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
