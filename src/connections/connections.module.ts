import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { GithubAdapter } from './adapters/github.adapter';

@Module({
  imports: [UsersModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, GithubAdapter],
  exports: [ConnectionsService, GithubAdapter],
})
export class ConnectionsModule {}
