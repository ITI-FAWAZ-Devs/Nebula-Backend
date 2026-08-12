import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { GitModule } from '../git/git.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { ChromaModule } from '../chroma/chroma.module';
import { ProgressModule } from '../progress/progress.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { DocumentationPipeline } from './documentation.pipeline';
import { DocumentationProcessor } from './documentation.processor';
import { StaleJobRecoveryService } from './stale-job-recovery.service';
import { AskService } from './ask.service';
import { DOCUMENTATION_QUEUE } from './documentation.constants';
import { ARCHITECTURE_DRAFT_QUEUE } from '../architecture-doc/architecture-doc.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: DOCUMENTATION_QUEUE },
      { name: ARCHITECTURE_DRAFT_QUEUE },
    ),
    UsersModule,
    AnalysisModule,
    IntegrationsModule,
    OrganizationsModule,
    WorkspaceModule,
    GitModule,
    DiscoveryModule,
    AiProviderModule,
    ChromaModule,
    ProgressModule,
    SubscriptionModule,
  ],
  controllers: [RepositoriesController],
  providers: [
    RepositoriesService,
    GithubClientService,
    DocumentationPipeline,
    DocumentationProcessor,
    StaleJobRecoveryService,
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
