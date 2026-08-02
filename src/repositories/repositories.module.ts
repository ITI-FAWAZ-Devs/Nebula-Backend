import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { GitModule } from '../git/git.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { ChromaModule } from '../chroma/chroma.module';
import { ProgressModule } from '../progress/progress.module';
import { DocumentationPipeline } from './documentation.pipeline';
import { AskService } from './ask.service';

@Module({
  imports: [
    UsersModule,
    AnalysisModule,
    WorkspaceModule,
    GitModule,
    DiscoveryModule,
    AiProviderModule,
    ChromaModule,
    ProgressModule,
  ],
  controllers: [RepositoriesController],
  providers: [
    RepositoriesService,
    GithubClientService,
    DocumentationPipeline,
    AskService,
  ],
  exports: [
    RepositoriesService,
    GithubClientService,
    DocumentationPipeline,
    AskService,
  ],
})
export class RepositoriesModule {}
