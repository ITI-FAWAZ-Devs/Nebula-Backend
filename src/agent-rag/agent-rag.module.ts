import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module';
import { ChromaModule } from '../chroma/chroma.module';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { AgentRagController } from './agent-rag.controller';
import { AgentRagService } from './agent-rag.service';
import { HitEnricherService } from './retrieval/hit-enricher.service';
import { VectorRetrievalService } from './retrieval/vector-retrieval.service';
import { GraphRetrievalService } from './retrieval/graph-retrieval.service';
import { HybridRetrievalService } from './retrieval/hybrid-retrieval.service';
import { RerankerService } from './retrieval/reranker.service';
import { ToolResultCache } from './retrieval/tool-result-cache';
import { AnswerCacheService } from './retrieval/answer-cache.service';
import { TavilySearchService } from './retrieval/tavily-search.service';
import { CitationSnippetService } from './retrieval/citation-snippet.service';
import { PlannerService } from './orchestration/planner.service';
import { ExecutorService } from './orchestration/executor.service';
import { ContextBuilderService } from './orchestration/context-builder.service';
import { SynthesizerService } from './orchestration/synthesizer.service';
import { FollowupGeneratorService } from './orchestration/followup-generator.service';
import { FastAnswerService } from './orchestration/fast-answer.service';
import { DeepResearchService } from './orchestration/deep-research.service';
import { AgentLoopService } from './orchestration/agent-loop.service';
import { AgentSessionStore } from './session/agent-session.store';
import { ConversationPersistenceService } from './persistence/conversation-persistence.service';

@Module({
  imports: [GeminiModule, ChromaModule, Neo4jModule, PrismaModule, AiProviderModule],
  controllers: [AgentRagController],
  providers: [
    AgentRagService,
    HitEnricherService,
    VectorRetrievalService,
    GraphRetrievalService,
    HybridRetrievalService,
    RerankerService,
    ToolResultCache,
    AnswerCacheService,
    TavilySearchService,
    CitationSnippetService,
    PlannerService,
    ExecutorService,
    ContextBuilderService,
    SynthesizerService,
    FollowupGeneratorService,
    FastAnswerService,
    DeepResearchService,
    AgentLoopService,
    AgentSessionStore,
    ConversationPersistenceService,
  ],
  exports: [
    AgentLoopService,
    HybridRetrievalService,
    AgentSessionStore,
    AnswerCacheService,
    FastAnswerService,
    DeepResearchService,
    ConversationPersistenceService,
  ],
})
export class AgentRagModule {}
