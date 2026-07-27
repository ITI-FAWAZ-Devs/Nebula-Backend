# Implementation Plan: Persist Architecture Documents

**Branch**: `004-document-persistence-api` | **Date**: 2026-07-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-document-persistence-api/spec.md`

## Summary

Expose the existing grounded architecture-drafting pipeline through repository-scoped REST endpoints and a BullMQ worker. A request creates a `GeneratedDoc` version, uses that document ID as the BullMQ job ID, and returns immediately. The worker reports drafting progress on the document, persists non-removed draft sections and any diagram atomically, and leaves every completed version readable. No new database tables or migrations are needed because Phase 1 already supplies the document schema.

## Technical Context

**Language/Version**: TypeScript 5.7, target ES2021

**Primary Dependencies**: NestJS 11, `@nestjs/bullmq`/BullMQ 5, Prisma 7, class-validator 0.15

**Storage**: PostgreSQL 18 through Prisma; existing `GeneratedDoc`, `DocSection`, and `DocStatus` models; Redis 7 for BullMQ

**Testing**: Jest 29 with ts-jest; unit specs co-located in `src`; endpoint/integration specs in `test`

**Target Platform**: Node.js NestJS backend service

**Project Type**: Single NestJS web service

**Performance Goals**: A trigger request returns after persisting and enqueueing its document version, without waiting for drafting; the existing drafting pipeline remains targeted at p95 under 90 seconds for a mid-sized indexed repository (~200 files).

**Constraints**: Reuse the existing document schema and Phase 2 drafting contract. All endpoints remain JWT-protected and enforce `repository.userId === currentUser.id`. One active document generation is allowed per repository; a duplicate request returns the existing references. A request may omit `commitSha` or supply only the repository's current indexed commit. Citations, verification outcomes, and diagram source are persisted unchanged from the grounded draft.

**Scale/Scope**: One background job and one versioned document per accepted request. History is repository-scoped; previous versions are immutable and latest means latest `COMPLETED` version. No automatic commit-triggered regeneration, UI, or document editing.

## Constitution Check

### Pre-design

- **Ownership**: `ArchitectureDocModule` owns `ArchitectureDocController`, `ArchitectureDocService`, `ArchitectureDocProcessor`, the `architecture-draft` queue registration, and request/response DTOs. `DraftingOrchestratorService` remains the owner of drafting; its public call gains only an optional progress reporter. `PrismaService` remains the persistence boundary.
- **Executable verification**: Unit tests cover authorization, readiness, active-request reuse, indexed-commit validation, version creation, status transitions, persistence, and terminal failures. An endpoint flow test covers trigger → poll → latest fetch → regeneration/history using a controlled drafting result.
- **Jobs and workspaces**: `ArchitectureDocProcessor` performs document drafting through BullMQ. It creates no workspace, so no workspace cleanup is required; worker errors always update the matching document to `FAILED` with an error message.
- **Grounding**: The worker persists only the `DraftingOrchestratorService` result. It adds no prose, citations, or diagram nodes; removed draft sections are not published.
- **Tenant isolation**: Every controller/service read and trigger first finds the repository and checks its `userId`. Worker payloads use the already-authorized document ID and repository ID only.

### Post-design

PASS. The design reuses existing NestJS, Prisma, and BullMQ boundaries; creates no workspace or storage client; keeps grounded drafting unchanged except for observable progress; and provides executable coverage for each exposed behavior. No constitutional exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/004-document-persistence-api/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── architecture-doc-api.md
└── tasks.md                       # Created later by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── architecture-doc/
│   ├── architecture-doc.module.ts             # Register queue, controller, service, worker
│   ├── architecture-doc.controller.ts         # Repository-scoped document endpoints
│   ├── architecture-doc.service.ts            # Authorization, versioning, reads, queueing
│   ├── architecture-doc.processor.ts          # BullMQ worker and document persistence
│   ├── architecture-doc.constants.ts          # Queue name and payload type
│   ├── drafting-orchestrator.service.ts       # Add optional progress reporting only
│   ├── dto/
│   │   ├── architecture-draft.dto.ts          # Existing in-memory draft types
│   │   └── architecture-doc.dto.ts            # Trigger and response DTOs
│   └── *.spec.ts                              # Unit coverage for new behavior
└── app.module.ts                              # Unchanged: already imports ArchitectureDocModule

test/
└── architecture-doc.e2e-spec.ts               # Trigger, poll, fetch, history, regenerate flow
```

**Structure Decision**: Keep the entire HTTP, queue, and persistence surface inside the existing `architecture-doc` module. Reuse `GeneratedDoc` as both the persisted job record and, by setting BullMQ's custom job ID to `GeneratedDoc.id`, the polling job identifier. This avoids a redundant job table or queue-ID column.

## Implementation Approach

1. Add `ARCHITECTURE_DRAFT_QUEUE` and a typed payload containing `repositoryId`, `documentId`, and `userId`. Register the queue in `ArchitectureDocModule`; add the controller, service, and processor as module members.

2. Add a compact `ArchitectureDocService` that:
   - verifies repository existence and ownership for every user-facing operation;
   - validates readiness and the optional commit reference against `lastIndexedCommit`;
   - creates/reuses documents in a serializable transaction: return an active `PENDING`/`RETRIEVING`/`GENERATING`/`VERIFYING` document if present, otherwise calculate `max(version) + 1` and create a `PENDING` document;
   - enqueues the payload with `jobId: document.id`; if enqueueing fails, marks the just-created document `FAILED` before surfacing the error;
   - reads the latest completed document, version history, a requested version, and a job by document/job ID.

3. Add `ArchitectureDocProcessor` as a `WorkerHost`. It marks the document `RETRIEVING`, calls the existing drafting orchestrator with a progress callback, persists non-removed sections plus the diagram in one database transaction, calculates `verified sections / persisted sections` when at least one section remains, and then marks it `COMPLETED` with `generatedAt`. On any unhandled failure it writes `FAILED` and a bounded error message.

4. Extend `DraftingOrchestratorService.draft()` with an optional internal progress callback. Report `RETRIEVING` before broad evidence retrieval, `GENERATING` before draft creation, and `VERIFYING` when verification begins; preserve current draft content and error behavior. Because per-section generation and verification are interleaved, the externally visible status is monotonic and remains `VERIFYING` once verification has begun.

5. Add `ArchitectureDocController` under `repositories/:repositoryId/architecture-doc`. Keep the project's existing `{ success, message, data }` response envelope while the `data` shapes follow [the API contract](contracts/architecture-doc-api.md): trigger, job polling, latest completed document, version history, specific version, and regeneration. Use the global JWT guard and `@CurrentUser('id')`; validate UUID path values and the optional request body.

6. Do not alter `prisma/schema.prisma` or add a migration: its existing unique repository-version constraint, active-status index, ordered sections, citations, verification fields, diagram, and error fields satisfy this phase. Use the existing models directly.

7. Add focused unit tests for the service, processor, progress callback, and controller delegation. Add an endpoint flow test with a controlled draft result that verifies immediate trigger data, persisted terminal progress, ordered retrieval, an immutable first version after regeneration, failure recording, and owner-only access.

## Complexity Tracking

No constitutional violations or additional abstractions require justification.
