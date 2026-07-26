# Tasks: Grounded Architecture Drafting

**Input**: Design documents from `specs/003-architecture-drafting/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [drafting-pipeline.md](contracts/drafting-pipeline.md), [quickstart.md](quickstart.md)

**Verification**: Unit tests mock `GeminiService` and `HybridRetrieverService` for each pipeline stage. A seeded-hallucination fixture proves SC-003. An opt-in integration test exercises live Chroma and Neo4j stores. Do not add HTTP endpoints, BullMQ processors, persistence writes, or controller changes in this phase.

**Organization**: Tasks are grouped by user story. Complete Phase 1 and Phase 2 before story tasks. Tests must be written before the behavior they prove.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with tasks that touch different files and have no incomplete dependency.
- **[US#]**: User story that the task delivers.
- Every task names the files it must create or change.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish module boundaries, draft DTOs, and the Gemini LLM entry point used by all drafting services.

- [X] T001 Create `src/architecture-doc/architecture-doc.module.ts` importing `GeminiModule`, `ChromaModule`, `Neo4jModule`, and `PrismaModule`; register `HybridRetrieverService` and export `DraftingOrchestratorService` as the module's public API (provider stubs may be added in T011).
- [X] T002 Create `src/architecture-doc/dto/architecture-draft.dto.ts` with exported TypeScript types/interfaces for `VerificationVerdict`, `SectionPlan`, `DraftSection`, `ArchitectureDiagram`, `ArchitectureDraft`, and `DraftRequest` per `data-model.md` field names and constraints.
- [X] T003 [P] Create `src/architecture-doc/templates/` directory with four empty prompt-builder module stubs: `structure-plan.prompt.ts`, `section-generation.prompt.ts`, `section-verification.prompt.ts`, and `diagram-generation.prompt.ts`.
- [X] T004 Add a generic `generateContent(prompt: string): Promise<string>` method to `src/gemini/gemini.service.ts` that calls the configured LLM model, returns non-empty text, and logs failures; drafting services MUST use this method rather than importing `@google/generative-ai` directly.
- [X] T005 Import `ArchitectureDocModule` in `src/app.module.ts` so the drafting pipeline is wired into the NestJS application without exposing any new HTTP route.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Versioned prompt templates, shared LLM response parsing, and module provider registration. These tasks block all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 [P] Implement `buildStructurePlanPrompt()` in `src/architecture-doc/templates/structure-plan.prompt.ts` as a pure function accepting repository metadata and `HybridRetrievalContext`; instruct the model to return JSON matching `SectionPlan[]` schema inline; list evidence as numbered `[filePath]: description` entries; forbid template-only sections not supported by evidence.
- [X] T007 [P] Implement `buildSectionGenerationPrompt()` in `src/architecture-doc/templates/section-generation.prompt.ts` as a pure function accepting a `SectionPlan` and focused `HybridRetrievalContext`; instruct inline `[filePath]` citations for every non-trivial claim and forbid claims without evidence support.
- [X] T008 [P] Implement `buildSectionVerificationPrompt()` in `src/architecture-doc/templates/section-verification.prompt.ts` as a pure function accepting a `DraftSection` and the same `HybridRetrievalContext` used for generation; instruct independent claim-by-claim and citation checks with a JSON verdict response (`verified` / `unverified` / `removed`, optional rewritten body, notes).
- [X] T009 [P] Implement `buildDiagramGenerationPrompt()` in `src/architecture-doc/templates/diagram-generation.prompt.ts` as a pure function accepting `FileRelationship[]`, `ModuleCluster[]`, and verified section summaries; instruct Mermaid `flowchart TD` or `graph TD` output using only evidenced modules.
- [X] T010 Create `src/architecture-doc/utils/llm-response.util.ts` with exported helpers to extract JSON from LLM text, parse with one automatic retry on malformed output, and validate required fields for `SectionPlan[]`, `DraftSection`, and diagram responses.
- [X] T011 Complete provider registration in `src/architecture-doc/architecture-doc.module.ts` for `HybridRetrieverService`, `StructurePlannerService`, `SectionGeneratorService`, `SectionVerifierService`, `DiagramGeneratorService`, and `DraftingOrchestratorService`; export only `DraftingOrchestratorService`.
- [X] T012 [P] Create `test/fixtures/drafting-pipeline/` with a minimal three-file fixture repository, a seeded-hallucination section fixture (unrelated/empty context), and `test/fixtures/drafting-pipeline/README.md` documenting each file's expected role in SC-001 through SC-004 checks.

**Checkpoint**: Prompt templates, DTOs, JSON utilities, and module wiring are ready. No drafting service implementation has started yet.

---

## Phase 3: User Story 2 - Get a Repository-Specific Structure (Priority: P1)

**Goal**: Broad repository evidence produces a validated, repository-specific `SectionPlan[]` with unique keys, titles, purposes, and retrieval topics — not a fixed template.

**Independent Test**: Draft structure plans for two fixture repositories with distinct detected concerns and confirm their section-key sets differ while every planned section has a purpose and retrieval topic.

### Verification for User Story 2

- [X] T013 [US2] Create `src/architecture-doc/structure-planner.service.spec.ts` before implementation. Mock `HybridRetrieverService`, `GeminiService`, and `PrismaService`; add failing cases for valid JSON plan parsing, duplicate-key rejection (keep first), empty/missing field rejection, empty broad evidence returning `[]`, and two repositories with different evidence producing different key sets (SC-002).
- [X] T014 [US2] Implement `StructurePlannerService.plan(repositoryId)` in `src/architecture-doc/structure-planner.service.ts`. Verify repository exists and has status `READY`; call `HybridRetrieverService.retrieve(repositoryId, { topic: 'architecture overview of the repository' })`; read repository metadata from Prisma; build prompt via `buildStructurePlanPrompt()`; parse and validate response via `llm-response.util.ts`.
- [X] T015 [US2] Add plan validation in `src/architecture-doc/structure-planner.service.ts`: discard entries with duplicate keys, empty/missing `key`, `title`, `purpose`, or `retrievalTopic`; return validated `SectionPlan[]` or `[]` when broad retrieval has `noEvidence: true`.
- [X] T016 [US2] Add malformed JSON handling in `src/architecture-doc/structure-planner.service.ts`: retry `GeminiService.generateContent()` once on parse failure; if still malformed, throw a planning-stage error covered by `structure-planner.service.spec.ts`.

**Checkpoint**: `npm test -- structure-planner.service.spec.ts` passes. Structure planning is independently testable without generation or verification.

---

## Phase 4: User Story 1 - Receive a Grounded Architecture Overview (Priority: P1) 🎯 MVP Core

**Goal**: For each planned section, focused retrieval and LLM generation produce markdown bodies with cited source files drawn exclusively from retrieval evidence.

**Independent Test**: Draft sections for a fixture repository and verify every returned section contains a non-empty body, at least one cited existing file path from the mocked evidence, and a pre-verification `verdict: 'unverified'`.

### Verification for User Story 1

- [X] T017 [US1] Create `src/architecture-doc/section-generator.service.spec.ts` before implementation. Mock `HybridRetrieverService` and `GeminiService`; add failing cases for content generation with inline citations, `sourceFiles` populated only from evidence paths, empty focused context producing minimal/unverified content, and citation paths absent from context being excluded (SC-001 partial).
- [X] T018 [US1] Implement `SectionGeneratorService.generate(repositoryId, plan, context?)` in `src/architecture-doc/section-generator.service.ts`. When `context` is omitted, call `HybridRetrieverService.retrieve(repositoryId, { topic: plan.retrievalTopic })`; build prompt via `buildSectionGenerationPrompt()`; parse response into `DraftSection` with `verdict: 'unverified'` and extracted `sourceFiles`.
- [X] T019 [US1] Add citation extraction and validation in `src/architecture-doc/section-generator.service.ts`: parse inline `[filePath]` references from `contentMd`; intersect with evidence file paths from the retrieval context; reject paths not present in context; update `section-generator.service.spec.ts` to assert SC-001 path existence against mocked evidence.
- [X] T020 [US1] Create `src/architecture-doc/drafting-orchestrator.service.ts` with `draft({ repositoryId })` skeleton: validate repository `READY` status; call `StructurePlannerService.plan()`; short-circuit with an empty `ArchitectureDraft` and diagnostic note when planning returns no sections; wire plan → per-section `SectionGeneratorService.generate()` loop.
- [X] T021 [US1] Assemble partial `ArchitectureDraft` in `src/architecture-doc/drafting-orchestrator.service.ts`: set `repositoryId`, `repositoryName`, ordered `sections`, `sectionPlan`, `sourceStatus` from the broad planning retrieval, and `generatedAt`; leave `diagram: null` until User Story 4.

**Checkpoint**: Plan → generate flow returns an in-memory draft with grounded citations. Verification and diagram stages are not yet wired.

---

## Phase 5: User Story 3 - Trust Verification to Catch Unsupported Content (Priority: P1)

**Goal**: Each generated section is independently verified against the same evidence context; unsupported claims are removed or the section is marked unverified with notes; one focused follow-up retrieval is allowed per section.

**Independent Test**: Supply a deliberately unrelated or empty context to a generated fixture section and confirm its unsupported claim is removed or the section is returned as unverified with verification notes (SC-003).

### Verification for User Story 3

- [X] T022 [US3] Create `src/architecture-doc/section-verifier.service.spec.ts` before implementation. Mock `HybridRetrieverService` and `GeminiService`; add failing cases for verified pass-through, unsupported claim removal, `unverified` marking with notes, invalid citation rejection, one follow-up retrieval triggered and capped at one call, and the seeded-hallucination fixture from `test/fixtures/drafting-pipeline/` (SC-003).
- [X] T023 [US3] Implement `SectionVerifierService.verify(section, context, repositoryId)` in `src/architecture-doc/section-verifier.service.ts`. Build prompt via `buildSectionVerificationPrompt()`; parse verifier JSON response; return rewritten verified body, or `verdict: 'unverified'` / `'removed'` with `verificationNotes` per contract failure semantics.
- [X] T024 [US3] Add follow-up retrieval logic in `src/architecture-doc/section-verifier.service.ts`: when the verifier response requests narrower evidence for a specific claim, call `HybridRetrieverService.retrieve()` once with a focused topic derived from that claim; merge only grounded follow-up files into the reassessment context; assert in `section-verifier.service.spec.ts` that a second follow-up is never attempted (FR-011).
- [X] T025 [US3] Integrate verification into `src/architecture-doc/drafting-orchestrator.service.ts`: after generation, call `SectionVerifierService.verify()` for each section using the same per-section retrieval context; preserve section order; handle LLM errors by returning the section as `unverified` with the error as `verificationNotes`.
- [X] T026 [US3] Add SC-005 assertion in `src/architecture-doc/section-verifier.service.spec.ts`: every section returned with `verdict: 'verified'` has at least one supporting cited repository file in `sourceFiles`.

**Checkpoint**: Full plan → generate → verify pipeline returns grounded sections with verification outcomes. Diagram generation is not yet wired.

---

## Phase 6: User Story 4 - See a Grounded System Diagram (Priority: P2)

**Goal**: After verification, one Mermaid diagram summarizes only modules present in relationship evidence; malformed or ungrounded diagrams are omitted with notes.

**Independent Test**: Draft an overview for a fixture repository, validate returned diagram syntax, and compare every diagrammed module against retrieved relationship evidence (SC-004).

### Verification for User Story 4

- [X] T027 [US4] Create `src/architecture-doc/diagram-generator.service.spec.ts` before implementation. Mock `GeminiService`; add failing cases for valid `flowchart`/`graph` output, modules cross-referenced against `moduleClusters` and `relationships`, omission when no relationship evidence exists, rejection of modules absent from evidence, and malformed Mermaid returning `null` with notes (SC-004).
- [X] T028 [US4] Implement `DiagramGeneratorService.generate(relationships, clusters, sections)` in `src/architecture-doc/diagram-generator.service.ts`. Build prompt via `buildDiagramGenerationPrompt()`; parse LLM Mermaid output; validate syntax starts with `flowchart` or `graph`; extract node labels and verify each maps to an evidenced module/cluster.
- [X] T029 [US4] Integrate diagram generation into `src/architecture-doc/drafting-orchestrator.service.ts`: collect `relationships` and `moduleClusters` from per-section retrieval results; call `DiagramGeneratorService.generate()` after all sections are verified; set `ArchitectureDraft.diagram` or leave `null` with a diagnostic note when evidence is insufficient or validation fails.

**Checkpoint**: Full four-stage pipeline (plan → generate → verify → diagram) is functional in the orchestrator.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Orchestrator hardening, tenant isolation, integration testing, and quickstart validation across all stories.

- [X] T030 Implement partial-failure semantics in `src/architecture-doc/drafting-orchestrator.service.ts` per `contracts/drafting-pipeline.md`: propagate `HybridRetrieverService` errors when both sources unavailable; return empty draft with reason on insufficient broad evidence; mark section `removed` on generation parse failure; return draft without diagram on diagram failure; never fabricate sections, citations, or modules.
- [X] T031 Create `src/architecture-doc/drafting-orchestrator.service.spec.ts` with mocked stage services. Cover full pipeline success, planning produces no sections, all sections fail verification, diagram failure retains sections, and tenant isolation — every `HybridRetrieverService.retrieve` call receives the same `repositoryId` with no cross-repository data in the result (SC-006).
- [X] T032 [P] Create `test/drafting-pipeline.e2e-spec.ts` guarded by `RUN_DRAFTING_PIPELINE_INTEGRATION=true`. Seed a uniquely named fixture repository in PostgreSQL, Chroma (`repo-{repositoryId}`), and Neo4j using existing service boundaries; run `DraftingOrchestratorService.draft()`; assert SC-001, SC-003, and SC-004 against live stores; delete only fixture data in `afterAll`.
- [X] T033 Run all validation scenarios from `specs/003-architecture-drafting/quickstart.md` and fix any failing unit or opt-in integration tests until Scenarios 1–6 pass.
- [X] T034 [P] Add implementation-boundary comments at the top of each new service file in `src/architecture-doc/` identifying it as an internal Phase 2 drafting pipeline component with no public HTTP route, matching the Phase 1 comment style in `hybrid-retriever.service.ts`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**.
- **User Story 2 (Phase 3)**: Depends on Foundational — structure planning is pipeline stage 1.
- **User Story 1 (Phase 4)**: Depends on Foundational and US2 plan output — section generation consumes `SectionPlan[]`.
- **User Story 3 (Phase 5)**: Depends on US1 generated sections — verification consumes `DraftSection` + retrieval context.
- **User Story 4 (Phase 6)**: Depends on US3 verified sections and collected relationship evidence.
- **Polish (Phase 7)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 2 (P1)**: Can start after Foundational — no dependency on other stories.
- **User Story 1 (P1)**: Depends on US2 for `SectionPlan[]` input — independently testable via mocked plans.
- **User Story 3 (P1)**: Depends on US1 for generated sections — independently testable via fixture `DraftSection` inputs.
- **User Story 4 (P2)**: Depends on US3 verified sections and retrieval relationship data — independently testable via fixture inputs.

### Within Each User Story

- Tests MUST be written and FAIL before implementation.
- Prompt templates (Phase 2) before services that import them.
- Services before orchestrator integration tasks.
- Story checkpoint before moving to the next priority.

### Parallel Opportunities

- **Phase 1**: T003 can run in parallel with T001/T002/T004.
- **Phase 2**: T006, T007, T008, T009, and T012 can all run in parallel; T010 and T011 follow template completion.
- **After Foundational**: US2 (Phase 3) must complete before US1 orchestrator wiring; US1 section generator tests (T017–T019) can start while US2 implementation finishes if using mocked plans.
- **Phase 7**: T032 and T034 can run in parallel.

---

## Parallel Example: User Story 2

```bash
# After Phase 2 completes, start structure planner work:
Task T013: "Create structure-planner.service.spec.ts with failing cases"
Task T014: "Implement StructurePlannerService.plan()"

# Prompt templates were already built in parallel during Phase 2:
Task T006: "buildStructurePlanPrompt() in structure-plan.prompt.ts"
```

---

## Parallel Example: Foundational Phase

```bash
# Launch all prompt templates together (different files, no dependencies):
Task T006: "structure-plan.prompt.ts"
Task T007: "section-generation.prompt.ts"
Task T008: "section-verification.prompt.ts"
Task T009: "diagram-generation.prompt.ts"
Task T012: "test/fixtures/drafting-pipeline/"
```

---

## Implementation Strategy

### MVP First (P1 Stories: US2 + US1 + US3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (**CRITICAL** — blocks all stories)
3. Complete Phase 3: User Story 2 (structure planning)
4. Complete Phase 4: User Story 1 (section generation + partial orchestrator)
5. Complete Phase 5: User Story 3 (verification + full plan/generate/verify pipeline)
6. **STOP and VALIDATE**: Run `npm test -- architecture-doc` — every section must have citations and verification outcomes
7. Add Phase 6 (diagram) and Phase 7 (polish) for the complete feature

### Incremental Delivery

1. Setup + Foundational → shared templates and DTOs ready
2. User Story 2 → repository-specific section plans independently testable
3. User Story 1 → grounded section generation with citations
4. User Story 3 → verification guardrails and SC-003 hallucination fixture
5. User Story 4 → grounded Mermaid diagram
6. Polish → orchestrator hardening, SC-006 tenant isolation, live-store integration test

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 2 (structure planner)
   - Developer B: User Story 1 (section generator — using mocked plans)
   - Developer C: User Story 3 (verifier — using fixture sections)
3. Integrate via orchestrator tasks (T020, T025, T029, T030)
4. Developer D: User Story 4 (diagram) once US3 verification context collection is defined

---

## Notes

- Do not modify `HybridRetrieverService` retrieval contract or Phase 1 DTOs except for imports.
- Do not add Prisma migrations, `GeneratedDoc` writes, REST endpoints, or BullMQ jobs — deferred to Phase 3.
- `[P]` tasks touch different files with no incomplete dependency.
- `[US#]` label maps each task to its user story for traceability.
- Commit after each task or logical group; stop at any checkpoint to validate the story independently.
