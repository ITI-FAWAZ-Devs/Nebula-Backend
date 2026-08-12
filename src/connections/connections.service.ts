import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConnectionProvider, Connection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
import { GithubAdapter } from './adapters/github.adapter';
import {
  IProviderAdapter,
  RemoteRepository,
} from './interfaces/provider-adapter.interface';
import { CreateConnectionDto } from './dto/create-connection.dto';

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  private readonly adapters: Map<ConnectionProvider, IProviderAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    githubAdapter: GithubAdapter,
  ) {
    this.adapters = new Map<ConnectionProvider, IProviderAdapter>([
      [ConnectionProvider.GITHUB, githubAdapter],
    ]);
  }

  getAdapter(provider: ConnectionProvider): IProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new BadRequestException(
        `Provider ${provider} is not currently supported`,
      );
    }
    return adapter;
  }

  async createConnection(
    userId: string,
    dto: CreateConnectionDto,
  ): Promise<Connection> {
    const adapter = this.getAdapter(dto.provider);
    const validation = await adapter.validateToken(dto.rawToken);

    const label =
      dto.label ||
      `${dto.provider} Token (${validation.providerUsername || 'PAT'})`;
    const encryptedToken = this.encryptionService.encrypt(dto.rawToken);

    const data: Prisma.ConnectionCreateInput = {
      provider: dto.provider,
      credentialType: dto.credentialType || 'PAT',
      label,
      encryptedToken,
      scopes: validation.scopes,
      lastValidatedAt: validation.lastValidatedAt,
      isValid: true,
      createdByUser: { connect: { id: userId } },
    };

    if (dto.orgId) {
      data.organization = { connect: { id: dto.orgId } };
    } else {
      data.user = { connect: { id: userId } };
    }

    try {
      const connection = await this.prisma.connection.create({ data });
      this.logger.log(
        `Created connection ${connection.id} (${dto.provider}) for user ${userId}`,
      );
      return connection;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          `A connection with label "${label}" already exists for this provider.`,
        );
      }
      throw error;
    }
  }

  async listUserConnections(
    userId: string,
  ): Promise<Omit<Connection, 'encryptedToken'>[]> {
    const connections = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map(({ encryptedToken, ...rest }) => rest);
  }

  async getConnectionById(id: string, userId: string): Promise<Connection> {
    const connection = await this.prisma.connection.findUnique({
      where: { id },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.userId && connection.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this connection',
      );
    }

    return connection;
  }

  async getDecryptedToken(connectionId: string): Promise<string> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      select: { encryptedToken: true, isValid: true },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    if (!connection.isValid) {
      throw new BadRequestException(
        'The selected connection is invalid or revoked.',
      );
    }

    return this.encryptionService.decrypt(connection.encryptedToken);
  }

  async findDefaultUserConnection(
    userId: string,
    provider: ConnectionProvider = ConnectionProvider.GITHUB,
  ): Promise<Connection | null> {
    return this.prisma.connection.findFirst({
      where: { userId, provider, isValid: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteConnection(id: string, userId: string): Promise<void> {
    const connection = await this.getConnectionById(id, userId);
    await this.prisma.connection.delete({ where: { id: connection.id } });
    this.logger.log(`Deleted connection ${id} for user ${userId}`);
  }

  async fetchRemoteRepositories(
    userId: string,
    connectionId?: string,
    provider: ConnectionProvider = ConnectionProvider.GITHUB,
  ): Promise<RemoteRepository[]> {
    let conn: Connection | null = null;
    if (connectionId) {
      conn = await this.getConnectionById(connectionId, userId);
    } else {
      conn = await this.findDefaultUserConnection(userId, provider);
    }

    if (!conn) {
      throw new BadRequestException(
        `No active ${provider} connection found. Please add a connection first.`,
      );
    }

    const decryptedToken = this.encryptionService.decrypt(conn.encryptedToken);
    const adapter = this.getAdapter(conn.provider);
    return adapter.fetchUserRepositories(decryptedToken);
  }

  // ── Organisation-owned Connections ──────────────────────────────────────────

  /**
   * Creates a connection owned by an org.
   * Caller must already be verified to have connection:manage permission before calling this.
   */
  async createOrgConnection(
    userId: string,
    orgId: string,
    dto: CreateConnectionDto,
  ): Promise<Connection> {
    const adapter = this.getAdapter(dto.provider);
    const validation = await adapter.validateToken(dto.rawToken);

    const label =
      dto.label ||
      `${dto.provider} Token (${validation.providerUsername || 'PAT'})`;
    const encryptedToken = this.encryptionService.encrypt(dto.rawToken);

    const data: Prisma.ConnectionCreateInput = {
      provider: dto.provider,
      credentialType: dto.credentialType || 'PAT',
      label,
      encryptedToken,
      scopes: validation.scopes,
      lastValidatedAt: validation.lastValidatedAt,
      isValid: true,
      organization: { connect: { id: orgId } },
      createdByUser: { connect: { id: userId } },
    };

    try {
      const connection = await this.prisma.connection.create({ data });
      this.logger.log(
        `Created org connection ${connection.id} (${dto.provider}) for org ${orgId} by user ${userId}`,
      );
      return connection;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          `A connection with label "${label}" already exists for this provider in the organization.`,
        );
      }
      throw error;
    }
  }

  /**
   * Lists all connections owned by an org (strips encrypted tokens).
   */
  async listOrgConnections(
    orgId: string,
  ): Promise<Omit<Connection, 'encryptedToken'>[]> {
    const connections = await this.prisma.connection.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map(({ encryptedToken, ...rest }) => rest);
  }

  /**
   * Returns a single org-owned connection, verifying it belongs to the org.
   */
  async getOrgConnectionById(id: string, orgId: string): Promise<Connection> {
    const connection = await this.prisma.connection.findUnique({
      where: { id },
    });
    if (!connection || connection.orgId !== orgId) {
      throw new NotFoundException('Connection not found in this organization');
    }
    return connection;
  }

  /**
   * Deletes an org-owned connection.
   * Caller must already be verified to have connection:manage before calling this.
   */
  async deleteOrgConnection(id: string, orgId: string): Promise<void> {
    const connection = await this.getOrgConnectionById(id, orgId);
    await this.prisma.connection.delete({ where: { id: connection.id } });
    this.logger.log(`Deleted org connection ${id} for org ${orgId}`);
  }

  /**
   * Finds the default (most-recently-created valid) connection for an org.
   */
  async findDefaultOrgConnection(
    orgId: string,
    provider: ConnectionProvider = ConnectionProvider.GITHUB,
  ): Promise<Connection | null> {
    return this.prisma.connection.findFirst({
      where: { orgId, provider, isValid: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resolves a decrypted token for a repo operation.
   * Priority: explicit connectionId → org default (if orgId given) → user default.
   * Returns null for public repos (no token needed).
   */
  async resolveTokenForRepo(opts: {
    userId: string;
    orgId?: string | null;
    connectionId?: string | null;
    isPrivate?: boolean;
    provider?: ConnectionProvider;
  }): Promise<string | null> {
    const { userId, orgId, connectionId, isPrivate, provider = ConnectionProvider.GITHUB } = opts;

    // 1. Explicit connection
    if (connectionId) {
      return this.getDecryptedToken(connectionId);
    }

    // 2. Org default
    if (orgId) {
      const orgConn = await this.findDefaultOrgConnection(orgId, provider);
      if (orgConn) return this.encryptionService.decrypt(orgConn.encryptedToken);
    }

    // 3. User personal default
    const userConn = await this.findDefaultUserConnection(userId, provider);
    if (userConn) return this.encryptionService.decrypt(userConn.encryptedToken);

    // 4. No token — only acceptable for public repos
    if (isPrivate) {
      throw new BadRequestException(
        'A valid connection is required to access private repositories.',
      );
    }
    return null;
  }

  /**
   * Fetches metadata for a specific remote repository using an optional token.
   */
  async fetchRepoMetadata(
    owner: string,
    repo: string,
    token?: string | null,
    provider: ConnectionProvider = ConnectionProvider.GITHUB,
  ): Promise<RemoteRepository> {
    const adapter = this.getAdapter(provider);
    return adapter.fetchRepoMetadata(owner, repo, token ?? undefined);
  }
}
