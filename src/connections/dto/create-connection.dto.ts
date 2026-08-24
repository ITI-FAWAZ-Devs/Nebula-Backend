import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ConnectionProvider, CredentialType } from '@prisma/client';

export class CreateConnectionDto {
  @IsEnum(ConnectionProvider)
  provider: ConnectionProvider;

  @IsOptional()
  @IsEnum(CredentialType)
  credentialType?: CredentialType;

  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  @IsNotEmpty()
  rawToken: string;

  @IsOptional()
  @IsUUID()
  orgId?: string;
}
