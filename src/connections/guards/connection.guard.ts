import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConnectionProvider } from '@prisma/client';
import { ConnectionsService } from '../connections.service';

export const REQUIRED_PROVIDER_KEY = 'required_connection_provider';

@Injectable()
export class ConnectionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly connectionsService: ConnectionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const provider =
      this.reflector.getAllAndOverride<ConnectionProvider>(
        REQUIRED_PROVIDER_KEY,
        [context.getHandler(), context.getClass()],
      ) || ConnectionProvider.GITHUB;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) return false;

    const defaultConnection =
      await this.connectionsService.findDefaultUserConnection(
        userId,
        provider,
      );

    if (!defaultConnection) {
      throw new HttpException(
        {
          success: false,
          statusCode: 428,
          errorCode: 'CONNECTION_REQUIRED',
          message: `A valid ${provider} Connection is required before accessing repository features. Please add a connection via POST /api/connections.`,
        },
        428,
      );
    }

    return true;
  }
}
