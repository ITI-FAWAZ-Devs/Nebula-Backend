# Tasks: Agent RAG

## Phase 0a — Infra gaps
- [X] T001 Gemini `generateWithTools`, `generateContentStream`, `scoreRelevance`
- [X] T002 Chroma `queryCollection` optional `where`
- [X] T003 RedisModule + RedisService
- [X] T004 `@SkipResponseIntercept` + ResponseInterceptor support
- [X] T005 `normalizeSourceLocation` + HitEnricher

## Phase 0b — Contract
- [X] T006 RetrievalHit DTO + agent constants
- [X] T007 Neo4j frozen tool Cypher methods

## Phase 1 — Retrieval
- [X] T008 VectorRetrievalService + unit test
- [X] T009 GraphRetrievalService + tool cache + unit test
- [X] T010 HybridRetrievalService + Reranker + unit test

## Phase 2 — Orchestration
- [X] T011 Planner / Executor / ContextBuilder / Synthesizer / AgentLoop

## Phase 3–4 — Session + API
- [X] T012 AgentSessionStore (Redis)
- [X] T013 AgentRagController REST + SSE

## Phase 5 — Eval
- [X] T014 Fixtures + run-eval harness

## Phase 6 — Hardening
- [X] T015 Tool cache TTL, planner/hop caps, structured turn logging
