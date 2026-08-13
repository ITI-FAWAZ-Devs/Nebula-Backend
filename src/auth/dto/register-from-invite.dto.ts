import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterFromInviteDto {
  @IsString()
  @IsNotEmpty()
  inviteToken: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;
}
