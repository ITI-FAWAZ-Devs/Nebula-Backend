import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ConnectionsModule } from '../connections/connections.module';
import { GitService } from './git.service';

@Module({
  imports: [UsersModule, ConnectionsModule],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
