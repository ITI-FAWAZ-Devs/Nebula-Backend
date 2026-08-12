import { Injectable } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import { ConnectionsService } from '../connections/connections.service';

@Injectable()
export class GithubTokenService {
  constructor(private readonly connectionsService: ConnectionsService) {}

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
