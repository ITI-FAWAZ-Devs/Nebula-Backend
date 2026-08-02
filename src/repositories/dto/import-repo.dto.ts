import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';

export class ImportRepoDto {
  @IsString()
  @IsNotEmpty()
  githubRepoId: string;

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

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

