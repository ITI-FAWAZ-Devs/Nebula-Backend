import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GitService } from './git.service';

@Module({
  imports: [UsersModule],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
