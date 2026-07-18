import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';

@Module({
  imports: [UsersModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService, GithubClientService],
  exports: [RepositoriesService, GithubClientService],
})
export class RepositoriesModule {}
