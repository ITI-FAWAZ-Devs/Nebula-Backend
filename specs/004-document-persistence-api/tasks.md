# Tasks: Persist Architecture Documents

**Input**: Design documents from `specs/004-document-persistence-api/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/architecture-doc-api.md`, `quickstart.md`

**Verification**: Run the focused Jest specs after each completed phase. The feature adds no Prisma migration: `GeneratedDoc`, `DocSection`, and `DocStatus` already exist.

**Organization**: Tasks are grouped by user story so a smaller implementation model can complete one vertical slice at a time without redesigning the feature.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files with no unfinished-task dependency
- **[US#]**: User story traceability

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add only the shared types and queue registration needed by every endpoint and worker.

- [X] T001 [P] Create `ARCHITECTURE_DRAFT_QUEUE = 'architecture-draft'` and the `{ repositoryId, documentId, userId }` payload interface in `src/architecture-doc/architecture-doc.constants.ts`.
- [X] T002 [P] Create `CreateArchitectureDocDto` with optional string `commitSha` plus compact trigger, job-status, version-summary, and document response interfaces in `src/architecture-doc/dto/architecture-doc.dto.ts`.
- [X] T003 Write a failing progress-callback test in `src/architecture-doc/drafting-orchestrator.service.spec.ts` that expects retrieval, generation, and verification notifications while preserving the current returned draft.
- [X] T004 Add the optional progress callback to `DraftingOrchestratorService.draft()` in `src/architecture-doc/drafting-orchestrator.service.ts`; report `RETRIEVING` before broad retrieval, `GENERATING` before drafting, and `VERIFYING` when verification starts, without changing draft content or error handling.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Wire the existing module to the queue and define the one service/worker boundary used by every story.

**⚠️ CRITICAL**: Complete this phase before adding controller routes.

- [X] T005 Create the injectable class skeletons and constructor dependencies for `ArchitectureDocService`, `ArchitectureDocProcessor`, and `ArchitectureDocController` in `src/architecture-doc/architecture-doc.service.ts`, `src/architecture-doc/architecture-doc.processor.ts`, and `src/architecture-doc/architecture-doc.controller.ts`.
- [X] T006 Register the `architecture-draft` BullMQ queue, `ArchitectureDocController`, `ArchitectureDocService`, and `ArchitectureDocProcessor` in `src/architecture-doc/architecture-doc.module.ts`; retain existing drafting providers and exports.

**Checkpoint**: Shared queue and module wiring compile; no schema or migration task is required.

---

## Phase 3: User Story 1 - Generate and Read an Architecture Document (Priority: P1) 🎯 MVP

**Goal**: An owner starts a document request immediately and later reads the completed, grounded document.

**Independent Test**: With a ready owned repository and controlled draft result, trigger work, run the processor, then fetch the latest document and assert ordered sections, citations, verdicts, and diagram are preserved.

### Verification for User Story 1

- [X] T007 [P] [US1] Write service tests for owner/not-found checks, ready-state validation, omitted/current commit acceptance, invalid commit rejection, active-document reuse, queue ID equal to document ID, and queue-add failure in `src/architecture-doc/architecture-doc.service.spec.ts`.
- [X] T008 [P] [US1] Write processor success-path tests for `RETRIEVING` start, atomic persistence of non-removed sections, ordered section data, first persisted section diagram storage, verification-score calculation, and `COMPLETED` state in `src/architecture-doc/architecture-doc.processor.spec.ts`.
- [X] T009 [P] [US1] Write controller tests for `POST /repositories/:repositoryId/architecture-doc` and `GET /repositories/:repositoryId/architecture-doc`, including HTTP 202 and the existing `{ success, message, data }` envelope, in `src/architecture-doc/architecture-doc.controller.spec.ts`.

### Implementation for User Story 1

- [X] T010 [US1] Implement `ArchitectureDocService.start()` and `getLatestCompleted()` in `src/architecture-doc/architecture-doc.service.ts`: verify ownership/readiness/current indexed commit, return an active document when present, otherwise create the next `PENDING` version, enqueue with `jobId: document.id`, and mark a newly created document `FAILED` if enqueueing fails.
- [X] T011 [US1] Implement `ArchitectureDocProcessor.process()` success behavior in `src/architecture-doc/architecture-doc.processor.ts`: mark `RETRIEVING`, call the drafting orchestrator, filter `verdict === 'removed'`, and use one Prisma transaction to create the remaining `DocSection` rows, store the diagram on the lowest-order persisted section, calculate `verified / persisted`, and mark the document `COMPLETED` with `generatedAt`.
- [X] T012 [US1] Implement `ArchitectureDocController` with the trigger and latest-completed routes in `src/architecture-doc/architecture-doc.controller.ts`; use `@CurrentUser('id')`, UUID parameter validation, `CreateArchitectureDocDto`, `@HttpCode(HttpStatus.ACCEPTED)` for trigger, and the project response envelope.
- [X] T013 [US1] Add the focused owner flow in `test/architecture-doc.e2e-spec.ts`: trigger an owned ready repository, execute a controlled worker result, and assert the latest response preserves ordered sections, source files, verification fields, and diagram.

**Checkpoint**: An owner can trigger a job and retrieve its completed architecture document without blocking the request.

---

## Phase 4: User Story 2 - Follow Generation Progress and Failures (Priority: P1)

**Goal**: An owner can poll real generation progress and see terminal failures instead of a stuck document.

**Independent Test**: Make a controlled draft emit all progress callbacks and then throw; poll the matching job and verify ordered visible statuses and a terminal `FAILED` error.

### Verification for User Story 2

- [X] T014 [P] [US2] Extend `src/architecture-doc/architecture-doc.processor.spec.ts` with progress-callback assertions for `GENERATING` and `VERIFYING`, plus unhandled drafting/persistence failure assertions for `FAILED`, non-empty `errorMessage`, and no `COMPLETED` update.
- [X] T015 [P] [US2] Extend `src/architecture-doc/architecture-doc.controller.spec.ts` with owner and non-owner job-polling tests for `GET /repositories/:repositoryId/architecture-doc/jobs/:jobId`.

### Implementation for User Story 2

- [X] T016 [US2] Update `ArchitectureDocProcessor` in `src/architecture-doc/architecture-doc.processor.ts` to persist every drafting progress callback status, keep status monotonic after verification starts, and catch all worker errors to set the matching document to `FAILED` with a bounded message and terminal timestamp.
- [X] T017 [US2] Add `ArchitectureDocService.getJob()` in `src/architecture-doc/architecture-doc.service.ts`; require the job/document ID to belong to the owned route repository and return only `jobId`, `docId`, status, and error message.
- [X] T018 [US2] Add the job-polling route to `src/architecture-doc/architecture-doc.controller.ts` and return the service result in the established envelope.
- [X] T019 [US2] Extend `test/architecture-doc.e2e-spec.ts` with controlled progress and failure flows that poll the same document ID and assert the final state is either `COMPLETED` or `FAILED`, never an active status after the worker ends.

**Checkpoint**: Polling reflects progress and every worker failure leaves inspectable terminal state.

---

## Phase 5: User Story 3 - Regenerate Without Losing History (Priority: P2)

**Goal**: An owner creates a new version after completion while retaining immutable history.

**Independent Test**: Complete version 1, regenerate, complete version 2, then list and fetch both versions to prove version 1 is unchanged and latest resolves to version 2.

### Verification for User Story 3

- [X] T020 [P] [US3] Extend `src/architecture-doc/architecture-doc.service.spec.ts` with next-version, latest-completed-only, newest-first history, specific-version, and same-repository active-request tests.
- [X] T021 [P] [US3] Extend `src/architecture-doc/architecture-doc.controller.spec.ts` with history, specific-version, and regeneration route tests, including non-owner denial.

### Implementation for User Story 3

- [X] T022 [US3] Add `listVersions()` and `getVersion()` to `src/architecture-doc/architecture-doc.service.ts`; return history newest first and return no publishable sections for non-completed documents while always enforcing ownership.
- [X] T023 [US3] Add version-history, specific-version, and regeneration routes to `src/architecture-doc/architecture-doc.controller.ts`; reuse `start()` for regeneration so it creates the next version only when no active document exists.
- [X] T024 [US3] Extend `test/architecture-doc.e2e-spec.ts` with version 1 → regeneration → version 2 assertions, then verify the history list, specific historical content, latest completed version, and rejection of a non-owner request.

**Checkpoint**: Regeneration creates a new readable version and cannot corrupt prior history.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Confirm the smallest complete feature meets the contract and does not add unsupported infrastructure.

- [X] T025 Run and fix focused architecture-document unit specs with `npm test -- architecture-doc` from `src/architecture-doc/`.
- [X] T026 Run and fix the endpoint flow suite with `npm run test:e2e -- architecture-doc.e2e-spec.ts` from `test/architecture-doc.e2e-spec.ts`.
- [X] T027 Run the existing generated-document persistence suite with `RUN_GENERATED_DOCS_INTEGRATION=true` and `npm run test:e2e -- generated-docs.e2e-spec.ts`, recording any required local database prerequisite in `specs/004-document-persistence-api/quickstart.md`.
- [X] T028 Review `src/architecture-doc/` against `specs/004-document-persistence-api/contracts/architecture-doc-api.md` and remove any added migration, duplicate job table, queue-ID database field, or new abstraction not required by the contract.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: T001 and T002 can run in parallel; T003 then T004 updates the existing drafting boundary.
- **Phase 2**: T005 depends on Phase 1 types; T006 depends on T001, T005, and the new controller/processor files existing.
- **US1 (Phase 3)**: T007–T009 can be written after Phase 1. T010 depends on T001–T002; T011 depends on T004 and T010; T012 depends on T010; T013 depends on T011–T012.
- **US2 (Phase 4)**: T014–T015 can follow US1 test setup. T016 depends on T004 and T011; T017 depends on T010; T018 depends on T017; T019 depends on T016 and T018.
- **US3 (Phase 5)**: T020–T021 can begin after US1 service/controller work. T022 depends on T010; T023 depends on T022; T024 depends on T023.
- **Polish (Phase 6)**: T025–T028 run after all desired stories.

### User Story Dependencies

- **US1 (P1)**: MVP; it establishes the durable document and initial endpoints.
- **US2 (P1)**: Depends on the US1 worker and document record, then adds progress/failure visibility.
- **US3 (P2)**: Depends on US1 version creation and reads; it does not alter US2 behavior.

### Parallel Opportunities

- T001 and T002 are independent new files.
- T007–T009 are test-only tasks in separate files.
- T014 and T015 are independent test files.
- T020 and T021 are independent test files.

## Parallel Example: User Story 1

```text
Task: "T007 service tests in src/architecture-doc/architecture-doc.service.spec.ts"
Task: "T008 processor tests in src/architecture-doc/architecture-doc.processor.spec.ts"
Task: "T009 controller tests in src/architecture-doc/architecture-doc.controller.spec.ts"
```

## Implementation Strategy

### MVP First (US1)

1. Complete T001–T006.
2. Complete T007–T013.
3. Run the US1 focused test and stop: trigger plus latest retrieval is a usable vertical slice.

### Incremental Delivery

1. Add US1 for accepted work and completed documents.
2. Add US2 for real progress and terminal failures.
3. Add US3 for history and regeneration.
4. Run the Phase 6 checks; do not add migrations or new storage abstractions unless this contract changes.

## Notes

- Every task follows `- [ ] T### [P?] [US#?] Description with file path`.
- Tasks deliberately reuse the existing schema, BullMQ dependency, JWT guard, and drafting service.
- The worker creates no workspace; no workspace cleanup task is needed.
