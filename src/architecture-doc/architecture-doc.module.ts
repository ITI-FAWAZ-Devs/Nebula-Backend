import { Module } from '@nestjs/common';
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

@Module({
  imports: [GeminiModule, ChromaModule, Neo4jModule, PrismaModule],
  providers: [
    HybridRetrieverService,
    StructurePlannerService,
    SectionGeneratorService,
    SectionVerifierService,
    DiagramGeneratorService,
    DraftingOrchestratorService,
  ],
  exports: [HybridRetrieverService, DraftingOrchestratorService],
})
export class ArchitectureDocModule {}
