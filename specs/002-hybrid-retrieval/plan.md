# Implementation Plan: Hybrid Repository Retrieval

**Branch**: `002-hybrid-retrieval` | **Date**: 2026-07-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-hybrid-retrieval/spec.md`

## Summary

Add one internal `HybridRetrieverService` that turns a repository topic and/or seed paths into a bounded, ranked context from the existing semantic index and repository graph. It will reuse `GeminiService` for query embeddings, `ChromaService` for semantic candidates, and a new typed neighborhood-read method on `Neo4jService` for graph evidence. It will also add the `GeneratedDoc`, `DocSection`, and `DocStatus` persistence foundation through one Prisma migration.

## Technical Context

**Language/Version**: TypeScript 5.7, target ES2021

**Primary Dependencies**: NestJS 11, Prisma 7, `chromadb` 3.5, `neo4j-driver` 6.2, Google Generative AI SDK

**Storage**: PostgreSQL 18 via Prisma; existing Chroma collections named `repo-{repositoryId}`; existing Neo4j repository graph

**Testing**: Jest 29 with `ts-jest`; unit tests under `src`; integration tests under `test`

**Target Platform**: Node.js NestJS backend service

**Project Type**: Single NestJS web service

**Performance Goals**: p95 hybrid retrieval under 3 seconds for a representative mid-sized indexed repository

**Constraints**: Reuse existing index data; cap semantic candidates at 10 by default, default graph expansion at 1 hop with an explicit maximum of 2 hops, and return at most 25 ranked files. Never mix repository identifiers in a retrieval query.

**Scale/Scope**: One repository-scoped retrieval call feeds later architecture-document drafting. This phase adds no HTTP route, queue, drafting, or rendering work.

## Constitution Check

### Pre-design

- **Ownership**: Phase 1 adds `HybridRetrieverService` under `src/architecture-doc`; it owns fused retrieval only. `Neo4jService` owns the new graph-read method. `PrismaService` remains the persistence boundary. No pipeline or controller changes are required.
- **Executable verification**: Unit tests cover query validation, source merging, graph-neighbor inclusion, de-duplication, ranking, partial-source availability, and tenant repository filters. An integration test uses live configured Chroma and Neo4j stores plus a small fixture repository.
- **Jobs and workspaces**: Not applicable; this phase starts no asynchronous work and creates no workspace.
- **Grounding**: The returned context is exclusively derived from the existing semantic index and repository graph. It carries file paths and evidence sources for later citation handling.
- **Tenant isolation**: Every Chroma collection name and Neo4j traversal is scoped by the requested `repositoryId`; callers that expose this service later remain responsible for verifying repository ownership before calling it.

### Post-design

PASS. The design keeps raw storage clients behind existing service boundaries, preserves repository filters in both reads, and provides focused executable verification. No constitutional exception or added complexity is required.

## Project Structure

### Documentation (this feature)

```text
specs/002-hybrid-retrieval/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── hybrid-retrieval.md
└── tasks.md                  # created by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── architecture-doc/
│   ├── hybrid-retriever.service.ts
│   ├── hybrid-retriever.service.spec.ts
│   └── dto/
│       └── hybrid-retrieval-context.dto.ts
├── chroma/
│   └── chroma.service.ts                         # reused unchanged
├── gemini/
│   └── gemini.service.ts                         # reused unchanged
├── neo4j/
│   ├── neo4j.service.ts                          # typed neighborhood read
│   └── neo4j.service.spec.ts                     # neighborhood-query tests if needed
└── prisma/
    └── prisma.service.ts                         # reused unchanged

prisma/
├── schema.prisma                                 # GeneratedDoc, DocSection, DocStatus
└── migrations/
    └── <timestamp>_add_generated_docs/
        └── migration.sql

test/
└── hybrid-retrieval.e2e-spec.ts                  # live-store fixture integration test
```

**Structure Decision**: Add only the feature service, its DTO, the narrow Neo4j read capability, one migration, and focused tests. The `ArchitectureDocModule`, controller, queue processor, and drafting service belong to later phases.

## Implementation Approach

1. Define the internal query and context DTOs in `src/architecture-doc/dto/hybrid-retrieval-context.dto.ts`. The contract in [contracts/hybrid-retrieval.md](contracts/hybrid-retrieval.md) is the stable boundary for Phases 2 and 3.
2. Add a parameterized, repository-scoped Neo4j neighborhood query to `Neo4jService`. It must return only file-resolvable nodes and edges reachable from the canonical seed paths in one or two hops; graph nodes without a resolvable source path remain excluded from the file context.
3. Implement `HybridRetrieverService.retrieve(repositoryId, query, options)`: validate that a topic or seed path exists, confirm the repository exists, embed only a supplied topic, query Chroma when a topic is supplied, union semantic candidates with explicit seed paths, then request their graph neighborhood.
4. Normalize source paths before merging; preserve Chroma's raw distance, derive a metric-independent rank score from ordered semantic results, add graph evidence (direct neighbors receive more weight than second-hop neighbors), and deduplicate files and relationship edges by canonical path/edge identity. Return a maximum of 25 files.
5. Treat source availability distinctly from an empty result: when one store is unavailable, return grounded results from the other plus source diagnostics; when both respond successfully but have no evidence, return the valid no-evidence context; when both stores are unavailable, fail explicitly.
6. Extend `prisma/schema.prisma` with the Phase 1 document models and generate one PostgreSQL migration. Add the generated-document relation to `Repository`; preserve existing document versions and cascade deletion through document sections.
7. Add unit tests for the merge/ranking behavior using mocked existing services, and an opt-in integration test that seeds/retrieves a small fixture repository through the configured Chroma and Neo4j stores.

## Complexity Tracking

No constitutional violations or additional abstractions require justification.
