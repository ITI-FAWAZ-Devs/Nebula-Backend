import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';

@Module({
  imports: [UsersModule, AnalysisModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService, GithubClientService],
  exports: [RepositoriesService, GithubClientService],
})
export class RepositoriesModule {}
