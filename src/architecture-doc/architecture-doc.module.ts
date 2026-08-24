import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { ChromaModule } from '../chroma/chroma.module';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgressModule } from '../progress/progress.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { GitModule } from '../git/git.module';
import { MailModule } from '../mail/mail.module';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { ARCHITECTURE_DRAFT_QUEUE } from './architecture-doc.constants';
import { ArchitectureDocController } from './architecture-doc.controller';
import { ArchitectureDocService } from './architecture-doc.service';
import { ArchitectureDocProcessor } from './architecture-doc.processor';
import { ArchitectureDocEmbedderService } from './architecture-doc-embedder.service';
import { GeminiModule } from 'src/gemini/gemini.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: ARCHITECTURE_DRAFT_QUEUE,
    }),
    AiProviderModule,
    ChromaModule,
    Neo4jModule,
    PrismaModule,
    GeminiModule,
    ProgressModule,
    RepositoriesModule,
    GitModule,
    MailModule,
    SubscriptionModule,
    OrganizationsModule,
  ],
  controllers: [ArchitectureDocController],
  providers: [
    HybridRetrieverService,
    CodeContextLoaderService,
    StructurePlannerService,
    SectionGeneratorService,
    SectionVerifierService,
    DiagramGeneratorService,
    DraftingOrchestratorService,
    ArchitectureDocService,
    ArchitectureDocProcessor,
    ArchitectureDocEmbedderService,
  ],
  exports: [
    HybridRetrieverService,
    DraftingOrchestratorService,
    ArchitectureDocService,
    ArchitectureDocEmbedderService,
  ],
})
export class ArchitectureDocModule {}
