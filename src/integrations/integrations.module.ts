import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GithubTokenController } from './github-token.controller';
import { GithubTokenService } from './github-token.service';

import { ConnectionsModule } from '../connections/connections.module';

@Module({
  imports: [UsersModule, ConnectionsModule],
  controllers: [GithubTokenController],
  providers: [GithubTokenService],
  exports: [GithubTokenService],
})
export class IntegrationsModule {}
