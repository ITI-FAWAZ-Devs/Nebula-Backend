import { IsString, IsNotEmpty } from 'class-validator';

export class SaveGithubTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
