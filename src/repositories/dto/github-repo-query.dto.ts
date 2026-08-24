import {
  IsOptional,
  IsBooleanString,
  IsInt,
  IsUUID,
  IsString,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GithubRepoQueryDto {
  @IsOptional()
  @IsBooleanString()
  force?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  /** Case-insensitive substring match on repository name */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter by repository visibility */
  @IsOptional()
  @IsIn(['public', 'private', 'all'])
  visibility?: 'public' | 'private' | 'all';

  /** Sort order for the results */
  @IsOptional()
  @IsIn(['name', 'updated'])
  sort?: 'name' | 'updated';
}
