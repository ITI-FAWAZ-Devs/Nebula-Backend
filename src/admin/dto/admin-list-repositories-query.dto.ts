import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocStatus, RepositoryStatus } from '@prisma/client';

export enum AdminRepositorySortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  UPDATED_AT = 'updatedAt',
  LAST_DOCUMENTED_AT = 'lastDocumentedAt',
}

export enum AdminRepositorySortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class AdminListRepositoriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(RepositoryStatus)
  repositoryStatus?: RepositoryStatus;

  @IsOptional()
  @IsEnum(DocStatus)
  documentationStatus?: DocStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  owner?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(AdminRepositorySortBy)
  sortBy?: AdminRepositorySortBy;

  @IsOptional()
  @IsEnum(AdminRepositorySortOrder)
  sortOrder?: AdminRepositorySortOrder;
}
