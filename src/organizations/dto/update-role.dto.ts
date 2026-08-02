import {
  IsString,
  IsOptional,
  IsArray,
  ArrayMinSize,
  MinLength,
  MaxLength,
} from 'class-validator';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissions?: string[];
}
