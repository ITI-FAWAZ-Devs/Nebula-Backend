# Implementation Plan: Agent RAG Pipeline

**Branch**: `005-agent-rag` | **Date**: 2026-07-30 | **Spec**: [spec.md](spec.md)

## Summary

Add a Gemini function-calling agent over frozen Neo4j/Chroma tools with a shared `RetrievalHit` contract, Redis sessions, SSE streaming, tool-result caching, and an early eval harness. Coexists with architecture-doc hybrid retrieval and `/ask`.

## Technical Context

**Language/Version**: TypeScript 5.7  
**Primary Dependencies**: NestJS 11, Gemini (`@google/generative-ai`), Chroma, Neo4j, ioredis  
**Storage**: Neo4j (graph), Chroma (descriptions), Redis (sessions + tool cache), Postgres (repo ownership)  
**Testing**: Jest unit specs co-located under `src/agent-rag`  
**Constraints**: No free-text Cypher; 8k context budget; max 3 planner iterations; max 2 graph hops / 25 nodes per hop

## Project Structure

```text
specs/005-agent-rag/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/agent-rag-api.md
└── tasks.md

src/agent-rag/          # new module
src/redis/              # shared ioredis client
```

## Constitution Check

PASS — reuses NestJS boundaries; Cypher stays in `Neo4jService`; tenant isolation via repository ownership; no schema invention for Code/Rationale.

## Implementation Approach

1. Close infra gaps (Gemini tools/stream/rerank, Chroma where, RedisModule, SSE skip, sourceLocation normalize, HitEnricher).
2. Freeze RetrievalHit + Neo4j tool methods.
3. Vector / Graph / Hybrid + reranker with unit tests.
4. Planner → Executor → ContextBuilder → Synthesizer loop.
5. Redis sessions + REST/SSE API.
6. Eval fixtures + runner.
7. Tool cache, caps, structured logging.
