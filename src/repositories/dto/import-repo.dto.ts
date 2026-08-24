import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';

export class ImportRepoDto {
  @IsOptional()
  @IsString()
  githubRepoId?: string;

  @IsOptional()
  @IsString()
  providerRepoId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  owner: string;

  @IsString()
  @IsNotEmpty()
  defaultBranch: string;

  @IsBoolean()
  isPrivate: boolean;

  @IsUrl()
  @IsNotEmpty()
  cloneUrl: string;

  /** Remote last-updated timestamp from GitHub; informational only. */
  @IsOptional()
  @IsString()
  updatedAt?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  connectionId?: string;
}
