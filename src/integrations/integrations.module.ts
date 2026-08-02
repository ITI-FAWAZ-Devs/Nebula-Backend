import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GithubTokenController } from './github-token.controller';
import { GithubTokenService } from './github-token.service';

@Module({
  imports: [UsersModule],
  controllers: [GithubTokenController],
  providers: [GithubTokenService],
  exports: [GithubTokenService],
})
export class IntegrationsModule {}
