import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ImportFromUrlDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  connectionId?: string;
}
