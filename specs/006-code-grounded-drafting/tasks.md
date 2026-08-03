# Tasks: Code-Grounded Drafting

**Input**: Design documents from `specs/006-code-grounded-drafting/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/code-context-loader.md`, `quickstart.md`

**Verification**: Run the focused Jest specs after each completed phase. The feature adds no Prisma migration and no persisted schema; code evidence exists only in memory during drafting.

**Organization**: Tasks are grouped by user story so one vertical slice can be implemented and tested at a time.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files with no unfinished-task dependency
- **[US#]**: User story traceability

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add only the config bounds, DTO extensions, and the failing loader test that every story depends on.

- [x] T001 [P] Create `src/config/drafting.config.ts` registering the `drafting` namespace with `codeContextMaxFiles` (env `DRAFTING_CODE_CONTEXT_MAX_FILES`, default `12`), `codeContextMaxCharsPerFile` (env `DRAFTING_CODE_CONTEXT_MAX_CHARS_PER_FILE`, default `4000`), and `codeContextMaxTotalChars` (env `DRAFTING_CODE_CONTEXT_MAX_TOTAL_CHARS`, default `32000`); register it in the `load` array of `src/config/config.module.ts`.
- [x] T002 [P] Add optional `codeContent?: string` and `codeLoadError?: string` to `RetrievedFile` in `src/architecture-doc/dto/hybrid-retrieval-context.dto.ts`, and add required `userId: string` to `DraftRequest` in `src/architecture-doc/dto/architecture-draft.dto.ts`.
- [x] T003 Write failing unit tests in `src/architecture-doc/code-context-loader.service.spec.ts` covering: accessible `localPath` reuse; missing `localPath` triggers `GitService.clone` and updates `Repository.localPath`; clone failure returns `null`; per-file truncation to `codeContextMaxCharsPerFile`; the cumulative `codeContextMaxTotalChars` budget; an unreadable file yields `codeLoadError` while its description is retained; and a `null` root path returns the context unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the loader, wire it into the module, and thread `userId`/code root through the orchestrator so every story has a code source.

**⚠️ CRITICAL**: Complete this phase before stage-service prompt changes.

- [x] T004 Implement `CodeContextLoaderService` in `src/architecture-doc/code-context-loader.service.ts`: `ensureClone(repositoryId, userId)` resolves an accessible `Repository.localPath`, otherwise re-clones via `GitService.clone` into `<workspaceRoot>/draft-<repositoryId>` and persists the new path, memoized per `repositoryId`, returning `null` (logged) on failure; `enrich(context, rootPath)` reads bounded code for files in `combinedScore` order (max `codeContextMaxFiles`, per-file `codeContextMaxCharsPerFile`, cumulative `codeContextMaxTotalChars`), setting `codeContent` on success or `codeLoadError` on failure, keeping descriptions, and returning the context unchanged when `rootPath` is `null`.
- [x] T005 [P] Import `GitModule` and add `CodeContextLoaderService` to the providers of `src/architecture-doc/architecture-doc.module.ts`.
- [x] T006 Thread `userId` through `DraftingOrchestratorService.draft()` in `src/architecture-doc/drafting-orchestrator.service.ts`: after the readiness check, call `ensureClone(repositoryId, request.userId)` once, log code availability, and pass `codeRootPath` into `structurePlanner.plan()`, each `sectionGenerator.generate()`, and each `sectionVerifier.verify()` while preserving all progress reporting and partial-failure behavior.

**Checkpoint**: The loader resolves/reads code, and every stage signature accepts the code root; no prompt behavior changes yet.

---

## Phase 3: User Story 1 - Generate Sections From Real Code (Priority: P1) 🎯 MVP

**Goal**: Section generation receives and grounds content in the actual source code of its evidence files.

**Independent Test**: With a controlled retrieval context whose files carry `codeContent`, the built generation prompt embeds the code and the generator invokes enrichment; claims can be traced to the code.

### Verification for User Story 1

- [x] T007 [P] [US1] Extend `src/architecture-doc/templates/section-generation.prompt.ts` with a "Source code evidence" block: per enriched file render the path, one-line description, and the code snippet in a fenced block; render `[code unavailable: <codeLoadError>]` for files with `codeLoadError`; add instructions that every non-trivial claim and citation must be consistent with the shown code.

### Implementation for User Story 1

- [x] T008 [US1] Update `SectionGeneratorService.generate()` in `src/architecture-doc/section-generator.service.ts` to accept `codeRootPath`, enrich the (possibly internally retrieved) context via `CodeContextLoaderService.enrich(context, codeRootPath)`, and build the prompt from the enriched context.
- [x] T009 [US1] Update `src/architecture-doc/section-generator.service.spec.ts` to assert the prompt embeds loaded `codeContent`, renders `[code unavailable]` markers, and that enrichment is invoked with the provided root path.

**Checkpoint**: Generated sections are grounded in real code and cite paths whose code was in context.

---

## Phase 4: User Story 2 - Verify Claims Against Real Code (Priority: P1)

**Goal**: The verifier checks section claims against the same real code used for generation.

**Independent Test**: A section claim that contradicts the loaded code of a cited file is rewritten or marked unverified; the verifier's follow-up retrieval context is also code-enriched.

### Verification for User Story 2

- [x] T010 [P] [US2] Extend `src/architecture-doc/templates/section-verification.prompt.ts` with the same code-evidence block format and instructions to check each material claim and citation against the provided code.

### Implementation for User Story 2

- [x] T011 [US2] Update `SectionVerifierService.verify()` and `attemptFollowUp()` in `src/architecture-doc/section-verifier.service.ts` to accept `codeRootPath`, enrich the primary context and the follow-up context via `CodeContextLoaderService.enrich`, and build verification prompts from the enriched contexts.
- [x] T012 [US2] Update `src/architecture-doc/section-verifier.service.spec.ts` to assert the primary and follow-up prompts embed code evidence.

**Checkpoint**: Verification is code-aware and unsupported claims are handled against real code.

---

## Phase 5: User Story 3 - Plan Sections Using Code (Priority: P2)

**Goal**: Structure planning uses code for the most relevant files so the proposed section plan reflects real architecture.

**Independent Test**: The plan prompt embeds code evidence for the broad-retrieval files; two runs with the same evidence produce the same plan.

### Verification for User Story 3

- [x] T013 [P] [US3] Extend `src/architecture-doc/templates/structure-plan.prompt.ts` with the same code-evidence block format and instructions to propose sections grounded in the shown code.

### Implementation for User Story 3

- [x] T014 [US3] Update `StructurePlannerService.plan()` in `src/architecture-doc/structure-planner.service.ts` to accept `codeRootPath` and enrich the broad retrieval context via `CodeContextLoaderService.enrich` before building the plan prompt.
- [x] T015 [US3] Update `src/architecture-doc/structure-planner.service.spec.ts` to assert the plan prompt embeds code evidence.

**Checkpoint**: The section plan reflects the repository's real code, not template guesses.

---

## Phase 6: User Story 4 - Continue When Code Is Unavailable (Priority: P2)

**Goal**: Missing clones are re-cloned and unreadable files degrade to description-only evidence with an inspectable note, never aborting the draft.

**Independent Test**: `ensureClone` is called exactly once with the authorized `userId`; a `null` code root still completes a description-only draft; unreadable files render `[code unavailable]` markers and drafting continues.

### Verification for User Story 4

- [x] T016 [P] [US4] Extend `src/architecture-doc/drafting-orchestrator.service.spec.ts` to assert `ensureClone` receives the authorized `userId` and is invoked exactly once per `draft()`, and that a `null` code root completes a description-only draft without error.
- [x] T017 [P] [US4] Add a fixture case in `src/architecture-doc/code-context-loader.service.spec.ts` proving a file with `codeLoadError` still produces an enriched context whose description is retained and whose prompt rendering shows the unavailable marker, while the draft continues.

**Checkpoint**: Drafting never silently pretends code was used and never aborts because one file (or the whole clone) is unreadable.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Confirm the smallest complete feature meets the contract and stays within existing boundaries.

- [x] T018 Add the three `DRAFTING_CODE_CONTEXT_*` environment variables with defaults to `.env.example`.
- [x] T019 Run and fix the focused specs with `npm test -- code-context-loader drafting-orchestrator structure-planner section-generator section-verifier` from the repo root.
- [x] T020 Run the full architecture-doc unit suite with `npm test -- architecture-doc` and the endpoint flow with `npm run test:e2e -- architecture-doc.e2e-spec.ts`; update `specs/006-code-grounded-drafting/quickstart.md` if any real command or filename differs.
- [x] T021 Review `src/architecture-doc/` against `specs/006-code-grounded-drafting/contracts/code-context-loader.md`: confirm no raw code is persisted to `GeneratedDoc`/`DocSection`, `HybridRetrieverService` is unchanged, no new authorization surface exists, and all bounds are enforced.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: T001 and T002 are independent new-file changes; T003 depends on T002 (the DTO fields it asserts).
- **Phase 2**: T004 depends on T001–T002; T005 depends on T004 existing; T006 depends on T004 (and updates the orchestrator used by all later stories).
- **US1 (Phase 3)**: T007 is the prompt change; T008 depends on T002/T004/T007; T009 depends on T008.
- **US2 (Phase 4)**: T010 is the prompt change; T011 depends on T002/T004/T010; T012 depends on T011.
- **US3 (Phase 5)**: T013 is the prompt change; T014 depends on T002/T004/T013; T015 depends on T014.
- **US4 (Phase 6)**: T016 depends on T006; T017 depends on T004 and the prompt rendering from any story phase.
- **Polish (Phase 7)**: T018–T021 run after all desired stories.

### User Story Dependencies

- **US1 (P1)**: MVP; it establishes code-grounded generation.
- **US2 (P1)**: Depends on US1's generation context; adds code-aware verification.
- **US3 (P2)**: Depends on the loader and prompt block from US1; independent of US2.
- **US4 (P2)**: Depends on the orchestrator threading and loader fallback; validates resilience across all stories.

### Parallel Opportunities

- T001 and T002 are independent new files.
- T007, T010, and T013 are independent prompt-template edits.
- T016 and T017 are independent test-only tasks.
- T008/T011/T014 can be implemented after their prompt tasks and the foundational loader, in any order.

## Parallel Example: User Story 1

```text
Task: "T007 prompt block in src/architecture-doc/templates/section-generation.prompt.ts"
Task: "T008 generator enrichment in src/architecture-doc/section-generator.service.ts"
Task: "T009 generator spec in src/architecture-doc/section-generator.service.spec.ts"
```

## Implementation Strategy

### MVP First (US1)

1. Complete T001–T006.
2. Complete T007–T009.
3. Run the US1 focused test and stop: code-grounded generation is a usable vertical slice.

### Incremental Delivery

1. Add US1 for code-grounded generation.
2. Add US2 for code-aware verification.
3. Add US3 for code-aware planning.
4. Add US4 for resilience when code is unavailable.
5. Run the Phase 7 checks; do not persist code or change retrieval unless this contract changes.

## Notes

- Every task follows `- [ ] T### [P?] [US#?] Description with file path`.
- The feature reuses `GitService`/`GitModule`, the existing `architecture-doc` module, and existing prompt templates.
- No Prisma migration, no HTTP change, and no new authorization surface is introduced.
