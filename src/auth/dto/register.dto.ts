import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export type AccountType = 'personal' | 'organization';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsEnum(['personal', 'organization'], {
    message: 'accountType must be "personal" or "organization"',
  })
  @IsOptional()
  accountType?: AccountType;

  @IsString()
  @IsNotEmpty({
    message: 'Organization name is required when accountType is "organization"',
  })
  @ValidateIf((o) => o.accountType === 'organization')
  organizationName?: string;
}
