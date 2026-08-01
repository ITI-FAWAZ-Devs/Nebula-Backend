import { IsNotEmpty, IsUUID } from 'class-validator';

export class ChangeMemberRoleDto {
  @IsUUID()
  @IsNotEmpty()
  roleId: string;
}
