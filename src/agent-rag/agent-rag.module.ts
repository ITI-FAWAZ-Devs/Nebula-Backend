import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module';
import { ChromaModule } from '../chroma/chroma.module';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentRagController } from './agent-rag.controller';
import { AgentRagService } from './agent-rag.service';
import { HitEnricherService } from './retrieval/hit-enricher.service';
import { VectorRetrievalService } from './retrieval/vector-retrieval.service';
import { GraphRetrievalService } from './retrieval/graph-retrieval.service';
import { HybridRetrievalService } from './retrieval/hybrid-retrieval.service';
import { RerankerService } from './retrieval/reranker.service';
import { ToolResultCache } from './retrieval/tool-result-cache';
import { PlannerService } from './orchestration/planner.service';
import { ExecutorService } from './orchestration/executor.service';
import { ContextBuilderService } from './orchestration/context-builder.service';
import { SynthesizerService } from './orchestration/synthesizer.service';
import { AgentLoopService } from './orchestration/agent-loop.service';
import { AgentSessionStore } from './session/agent-session.store';

@Module({
  imports: [GeminiModule, ChromaModule, Neo4jModule, PrismaModule],
  controllers: [AgentRagController],
  providers: [
    AgentRagService,
    HitEnricherService,
    VectorRetrievalService,
    GraphRetrievalService,
    HybridRetrievalService,
    RerankerService,
    ToolResultCache,
    PlannerService,
    ExecutorService,
    ContextBuilderService,
    SynthesizerService,
    AgentLoopService,
    AgentSessionStore,
  ],
  exports: [AgentLoopService, HybridRetrievalService],
})
export class AgentRagModule {}
