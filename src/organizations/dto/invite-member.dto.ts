import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsUUID()
  @IsNotEmpty()
  roleId: string;
}
