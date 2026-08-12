import { ConnectionProvider, CredentialType } from '@prisma/client';

export class ConnectionResponseDto {
  id: string;
  provider: ConnectionProvider;
  credentialType: CredentialType;
  label: string | null;
  scopes: string[];
  lastValidatedAt: Date;
  isValid: boolean;
  userId: string | null;
  orgId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}
