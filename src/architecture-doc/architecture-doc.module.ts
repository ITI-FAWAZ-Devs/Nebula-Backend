import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { GeminiModule } from '../gemini/gemini.module';
import { ChromaModule } from '../chroma/chroma.module';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { ARCHITECTURE_DRAFT_QUEUE } from './architecture-doc.constants';
import { ArchitectureDocController } from './architecture-doc.controller';
import { ArchitectureDocService } from './architecture-doc.service';
import { ArchitectureDocProcessor } from './architecture-doc.processor';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: ARCHITECTURE_DRAFT_QUEUE,
    }),
    GeminiModule,
    ChromaModule,
    Neo4jModule,
    PrismaModule,
  ],
  controllers: [ArchitectureDocController],
  providers: [
    HybridRetrieverService,
    StructurePlannerService,
    SectionGeneratorService,
    SectionVerifierService,
    DiagramGeneratorService,
    DraftingOrchestratorService,
    ArchitectureDocService,
    ArchitectureDocProcessor,
  ],
  exports: [HybridRetrieverService, DraftingOrchestratorService, ArchitectureDocService],
})
export class ArchitectureDocModule {}
