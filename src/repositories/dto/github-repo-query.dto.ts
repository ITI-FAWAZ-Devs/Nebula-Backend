import { IsOptional, IsBooleanString, IsInt, Min, Max } from 'class-validator';
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
}
