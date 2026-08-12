import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import {
  ConnectionGuard,
  REQUIRED_PROVIDER_KEY,
} from '../guards/connection.guard';

export function RequireConnection(
  provider: ConnectionProvider = ConnectionProvider.GITHUB,
) {
  return applyDecorators(
    SetMetadata(REQUIRED_PROVIDER_KEY, provider),
    UseGuards(ConnectionGuard),
  );
}
