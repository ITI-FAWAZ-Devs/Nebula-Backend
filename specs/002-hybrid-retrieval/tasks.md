# Tasks: Hybrid Repository Retrieval

**Input**: Design documents from `specs/002-hybrid-retrieval/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [hybrid-retrieval.md](contracts/hybrid-retrieval.md), [quickstart.md](quickstart.md)

**Verification**: Unit tests are required for retrieval merge/ranking behavior. Environment-gated integration tests are required for the configured Chroma, Neo4j, and PostgreSQL stores. Do not add a controller, queue, workspace, or drafting service in this phase.

**Organization**: Tasks are grouped by user story. Complete Phase 2 before story tasks. Tests must be written before the behavior they prove.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with tasks that touch different files and have no incomplete dependency.
- **[US#]**: User story that the task delivers.
- Every task names the files it must create or change.

## Phase 1: Setup

**Purpose**: Establish the exact source and test locations without changing unrelated modules.

- [X] T001 Create `src/architecture-doc/` and `src/architecture-doc/dto/`; do not create `ArchitectureDocModule`, a controller, a BullMQ processor, or any public route in this phase.
- [X] T002 Read `specs/002-hybrid-retrieval/contracts/hybrid-retrieval.md` and add a short implementation comment at the top of `src/architecture-doc/hybrid-retriever.service.ts` identifying it as an internal Phase 1-only retrieval boundary.

---

## Phase 2: Foundational Contracts and Storage Reads

**Purpose**: Define the stable data shapes and the only permitted Neo4j read boundary. These tasks block both P1 stories.

- [X] T003 Create `src/architecture-doc/dto/hybrid-retrieval-context.dto.ts` with exported TypeScript interfaces/types for `HybridRetrievalQuery`, `HybridRetrievalOptions`, `HybridRetrievalContext`, retrieved files, file-resolved relationships, module clusters, and per-source statuses. Encode these exact defaults and bounds: `semanticLimit` 10 (1–20), `maxHops` 1 (only 1 or 2), and `maxFiles` 25 (1–25).
- [X] T004 Update `src/neo4j/neo4j.service.ts` with exported result types and one parameterized `getFileNeighborhood(repositoryId, seedPaths, maxHops)` method. Open and close its session in `try/finally`; match only nodes and relationships whose `repositoryId` equals the argument; resolve canonical file paths from `path`, `sourceFile`, or `name`; return only file-resolvable nodes/edges and optional graph-supplied cluster memberships. Do not expose the Neo4j driver or Cypher outside this service.
- [X] T005 Add focused tests for `getFileNeighborhood` in `src/neo4j/neo4j.service.spec.ts` using a mocked driver/session. Assert query parameters include `repositoryId`, `seedPaths`, and `maxHops`; assert the session closes after both a successful result and a thrown query error.

**Checkpoint**: `src/architecture-doc/dto/hybrid-retrieval-context.dto.ts` is the only retrieval contract, and `Neo4jService` has the only new graph read path.

---

## Phase 3: User Story 1 - Retrieve Grounded Repository Context (Priority: P1) 🎯 MVP

**Goal**: A drafting consumer can request one validated, repository-scoped context from a topic, seed paths, or both, and receive ranked unique file evidence from existing semantic and graph stores.

**Independent Test**: Instantiate `HybridRetrieverService` with mocked Prisma, Gemini, Chroma, and Neo4j services. Verify a topic lookup returns one context containing semantic candidates, requested seed paths, source diagnostics, and deterministic ranking without leaking a different repository's data.

### Verification for User Story 1

- [X] T006 [US1] Create `src/architecture-doc/hybrid-retriever.service.spec.ts` before the service implementation. Mock `PrismaService`, `GeminiService`, `ChromaService`, and `Neo4jService`; add failing cases for an absent repository, an empty topic plus empty seed list, topic-only lookup, seed-path-only lookup, and a topic-plus-seed lookup. Assert no embedding call for seed-only input and no source call for an invalid query.
- [X] T007 [US1] Implement `HybridRetrieverService` in `src/architecture-doc/hybrid-retriever.service.ts`. Inject only `PrismaService`, `GeminiService`, `ChromaService`, and `Neo4jService`; confirm the repository exists; trim and validate the query; call `GeminiService.embedString()` only for a non-empty topic; query only `repo-${repositoryId}` through `ChromaService.queryCollection()`; union semantic file paths with explicit seed paths; call `Neo4jService.getFileNeighborhood()` with the validated hop limit; and return the DTO from T003. Do not import ChromaDB or Neo4j drivers directly.
- [X] T008 [US1] Complete the semantic-result parser in `src/architecture-doc/hybrid-retriever.service.ts`: read the first Chroma result batch, preserve `metadata.filePath`, description, and raw distance as `semanticDistance`; reject records whose metadata belongs to another repository; canonicalize separators and repeated prefixes before using a path as a map key; and populate `missingSeedPaths` only for requested paths absent from all grounded evidence.
- [X] T009 [US1] Add deterministic baseline merging in `src/architecture-doc/hybrid-retriever.service.ts`: de-duplicate files by canonical path, preserve evidence sources, derive semantic rank score from Chroma result order rather than converting raw distance, cap the final files list at `maxFiles`, and sort ties by canonical path. Update `src/architecture-doc/hybrid-retriever.service.spec.ts` to assert duplicate semantic paths collapse to one record and output order is stable.

**Checkpoint**: `npm test -- hybrid-retriever.service.spec.ts` passes the User Story 1 cases. A topic or seed-path request returns a typed, repository-scoped, bounded context without a public endpoint.

---

## Phase 4: User Story 2 - Discover Connected Files (Priority: P1)

**Goal**: The context includes direct graph neighbors, optional second-hop evidence, file relationships, and only actual graph-supplied clusters; graph evidence improves ranking without inventing unavailable data.

**Independent Test**: In the unit suite, a semantic seed with a low-similarity direct neighbor returns both files and the direct relationship. In the live-store fixture suite, the same behavior is observed from configured Chroma and Neo4j stores.

### Verification for User Story 2

- [X] T010 [US2] Extend `src/architecture-doc/hybrid-retriever.service.spec.ts` with failing cases for: a direct graph neighbor outside semantic results; a two-hop path when `maxHops: 2`; duplicate graph edges; a both-signal file ranking ahead of an otherwise comparable single-signal file; empty cluster data; and a graph node without a source path. Assert returned relationships include canonical source path, target path, type, hop distance, and edge identifier.
- [X] T011 [P] [US2] Create a minimal deterministic fixture repository under `test/fixtures/hybrid-retrieval/` with exactly three source files: a semantic seed, a directly connected low-similarity neighbor, and one unrelated file. Add `test/fixtures/hybrid-retrieval/README.md` that identifies each file's expected role; do not add dependencies or executable application scaffolding.
- [X] T012 [US2] Extend the graph merge/ranking portion of `src/architecture-doc/hybrid-retriever.service.ts` to retain file-resolved relationships, add graph-only files, keep direct neighbors above second-hop-only files, apply a fixed graph-evidence boost so both-signal files beat otherwise comparable single-signal files, and return `moduleClusters` only as provided by `Neo4jService`. Never infer clusters from directories or names.
- [X] T013 [US2] Implement partial-source and no-evidence semantics in `src/architecture-doc/hybrid-retriever.service.ts` and cover them in `src/architecture-doc/hybrid-retriever.service.spec.ts`: one unavailable source plus available evidence resolves with source status; both successful-but-empty sources resolve with `noEvidence: true`; one unavailable plus one empty source resolves with `noEvidence: false`; both unavailable sources fail explicitly rather than being converted to an empty context.
- [X] T014 [US2] Create `test/hybrid-retrieval.e2e-spec.ts`. Guard the suite behind `RUN_HYBRID_RETRIEVAL_INTEGRATION=true`; seed a uniquely named fixture repository record, its Chroma collection, and its Neo4j graph using existing service boundaries; retrieve the fixture topic; assert the direct low-similarity graph neighbor appears with an edge, all files/edges are unique and repository-scoped, and 19 of 20 sequential retrieval calls complete in under 3 seconds. In `afterAll`, delete only the unique fixture database record, Chroma collection, and Neo4j nodes created by this test.

**Checkpoint**: The focused unit suite and the opt-in live-store suite prove that fusion—not vector search alone—returns connected repository files.

---

## Phase 5: User Story 3 - Preserve Document Storage Foundations (Priority: P2)

**Goal**: The database can retain versioned generated documents and ordered sections with statuses, citations, verification data, uniqueness constraints, and cascade deletion for later phases.

**Independent Test**: Against a fresh test database, create two document versions and ordered sections for one fixture repository; retrieve them in order; verify duplicate version/key rejection and cascading deletion.

### Verification for User Story 3

- [X] T015 [US3] Create `test/generated-docs.e2e-spec.ts` before the schema change. Guard it behind `RUN_GENERATED_DOCS_INTEGRATION=true`; write failing Prisma-client cases that create a fixture repository, persist `GeneratedDoc` and ordered `DocSection` rows, retrieve sections ordered by `order`, reject duplicate `(repositoryId, version)` and `(docId, key)` pairs, retain version 1 after version 2 exists, and verify repository deletion cascades through documents and sections. Clean up only the fixture repository in `afterAll`.
- [X] T016 [US3] Update `prisma/schema.prisma` with `DocStatus` values `PENDING`, `RETRIEVING`, `GENERATING`, `VERIFYING`, `COMPLETED`, and `FAILED`; add `GeneratedDoc` and `DocSection` using the fields, unique constraints, indexes, optional text fields, PostgreSQL string-array citations, and cascade relations specified in `specs/002-hybrid-retrieval/data-model.md`; add the `generatedDocs` relation to `Repository`; and map the new tables consistently with the existing snake_case table convention.
- [X] T017 [US3] Generate and inspect `prisma/migrations/<timestamp>_add_generated_docs/migration.sql` by running `npx prisma migrate dev --name add_generated_docs` followed by `npx prisma generate`. Confirm the SQL creates the enum, both tables, foreign keys with cascade behavior, unique constraints, and both required indexes; do not hand-write a second conflicting migration.
- [X] T018 [US3] Run and complete `test/generated-docs.e2e-spec.ts` against the migrated test database. If Prisma's known unique-constraint error code is asserted, assert it only at the test boundary; do not catch or hide uniqueness failures in application code.

**Checkpoint**: The generated Prisma client exposes the three new model types, and live database checks prove version history, ordered sections, uniqueness, and cascades.

---

## Phase 6: Polish and Cross-Cutting Verification

**Purpose**: Ensure the feature is buildable, documented by its executable checks, and remains strictly scoped to Phase 1.

- [X] T019 [P] Run `npx prisma validate` and `npm run build`; resolve only validation or TypeScript errors in `prisma/schema.prisma`, `src/architecture-doc/`, `src/neo4j/neo4j.service.ts`, and their tests.
- [X] T020 Run `npm test -- hybrid-retriever.service.spec.ts neo4j.service.spec.ts`, then run `RUN_HYBRID_RETRIEVAL_INTEGRATION=true npm run test:e2e -- hybrid-retrieval.e2e-spec.ts` and `RUN_GENERATED_DOCS_INTEGRATION=true npm run test:e2e -- generated-docs.e2e-spec.ts`; compare each outcome to `specs/002-hybrid-retrieval/quickstart.md` and update only that guide if the real command or test filename differs.
- [X] T021 Review `src/architecture-doc/`, `src/neo4j/neo4j.service.ts`, `prisma/schema.prisma`, and `test/` against `specs/002-hybrid-retrieval/spec.md`. Confirm no controller, queue, workspace, drafting, diagram, or indexing-pipeline change was introduced; confirm Chroma and Neo4j access remains inside their existing services; and confirm every graph query has a repository filter.

---

## Dependencies and Execution Order

```text
T001–T002
    │
    ├── T003 → T004 → T005
    │                 │
    │                 └── US1: T006 → T007 → T008 → T009
    │                                      │
    │                                      └── US2: T010 + T011 → T012 → T013 → T014
    │
    └── US3: T015 → T016 → T017 → T018
                                      │
                                      └── T019 → T020 → T021
```

### User Story Dependencies

- **US1 (P1)** depends on T003–T005 and is the MVP retrieval contract.
- **US2 (P1)** depends on US1 because it extends the same returned context with graph evidence and live-store verification.
- **US3 (P2)** depends only on setup; it can proceed in parallel with US1/US2 after T002 because it changes only Prisma and its dedicated test file.
- T019–T021 require the implemented stories being validated.

### Parallel Opportunities

- T011 may run while T010 is being written because it touches only fixture files.
- T015–T018 (US3) may run in parallel with T003–T014 (US1/US2), subject to migration access to the shared development database.
- T019 can run independently after implementation is complete; T020 remains the final executable integration gate.

## Implementation Strategy

### MVP First

1. Complete T001–T005 to establish the DTO and safe graph-read boundary.
2. Complete T006–T009 and run the US1 unit check.
3. Stop: the service now supplies a usable, bounded hybrid context to later drafting work.

### Incremental Delivery

1. Add US2 graph expansion and live-store proof (T010–T014).
2. Add the independent document persistence foundation (T015–T018).
3. Run the cross-cutting validation gate (T019–T021).

### Guardrails for Implementation Models

- Use only the existing `GeminiService`, `ChromaService`, `Neo4jService`, and `PrismaService`; do not install packages.
- Preserve Chroma's raw distance; use result rank for semantic scoring because no distance metric is declared.
- Do not convert unavailable storage into a fabricated empty result.
- Never delete a broad collection, graph, or database in tests; test fixture identifiers must be unique and cleanup must target only those identifiers.
- Keep Phase 1 internal: no HTTP routes, queue work, document generation, or Graphify configuration change.
