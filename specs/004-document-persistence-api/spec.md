# Feature Specification: Persist Architecture Documents

**Feature Branch**: `004-document-persistence-api`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Phase 3 — Document Persistence, REST API & Background Jobs from Build-Drafting-Agent-PLAN.md"

## Clarifications

### Session 2026-07-26

- Q: What happens when a generation is already active for the repository? → A: Return the existing active document and job identifiers; do not create another version.
- Q: Which commit reference may a document-generation request use? → A: An omitted reference or the repository's currently indexed commit; reject other references.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate and Read an Architecture Document (Priority: P1)

An authorized repository owner can request an architecture document for an indexed repository, receive an immediate tracking reference, and later retrieve the completed document with its ordered sections and diagram.

**Why this priority**: This makes the grounded drafting capability useful outside the service process while keeping a potentially long-running generation request responsive.

**Independent Test**: Request a document for a ready fixture repository, poll its tracking reference until it completes, then retrieve the latest document and verify its persisted sections and diagram match the completed draft.

**Acceptance Scenarios**:

1. **Given** an authorized owner and a repository ready for drafting, **When** the owner requests an architecture document, **Then** the system immediately returns a document identifier, job identifier, initial version, and pending status while generation continues in the background.
2. **Given** a completed document for a repository, **When** its owner fetches the latest document, **Then** the system returns its version, completion details, ordered sections, cited source files, verification outcomes, and available diagram.
3. **Given** an authorized user who does not own the repository, **When** they try to trigger, poll, or fetch an architecture document, **Then** the system denies access without exposing document contents or job details.

---

### User Story 2 - Follow Generation Progress and Failures (Priority: P1)

An authorized repository owner can poll a document-generation job and see its current drafting stage or a useful failure reason instead of waiting with no visibility.

**Why this priority**: Generation can take time and may fail; timely, inspectable status lets clients present an honest progress state and lets owners retry deliberately.

**Independent Test**: Trigger a fixture document generation, observe each applicable stage through polling, and separately force a drafting failure to confirm the document reaches a terminal failed state with an error message.

**Acceptance Scenarios**:

1. **Given** a newly accepted document request, **When** the owner polls its job, **Then** the response identifies the same document and reports its current status.
2. **Given** a document moving through drafting, **When** the owner polls during each phase, **Then** the visible status advances through retrieval, generation, verification, and completion in order where those phases execute.
3. **Given** generation fails at any stage, **When** processing ends, **Then** the document is marked failed, contains an inspectable error message, and is never left indefinitely in a non-terminal stage.

---

### User Story 3 - Regenerate Without Losing History (Priority: P2)

An authorized repository owner can request a new architecture document version after the repository changes while retaining every previous version for later reading.

**Why this priority**: Architecture documentation must remain current, while historical versions are needed for comparison and confidence in prior output.

**Independent Test**: Complete a first fixture document, request regeneration, complete the second version, and verify that both versions remain retrievable with distinct version numbers and unchanged first-version content.

**Acceptance Scenarios**:

1. **Given** one or more existing document versions, **When** the owner requests regeneration, **Then** the system creates a new pending version and leaves all earlier versions readable.
2. **Given** multiple document versions, **When** the owner lists document history, **Then** the system returns each version's identifier, version number, status, generation time, and verification score.
3. **Given** a requested historical version, **When** the owner fetches it, **Then** the system returns that version's own persisted content rather than the latest document.

### Edge Cases

- The repository is not ready or does not have the indexed evidence needed for drafting: reject the request before creating work that cannot complete.
- A request is made while a document generation for the same repository is already active: return its existing document and job identifiers without starting a competing generation or creating another version.
- No completed document exists: fetching the latest completed document clearly reports that no completed version is available.
- A completed draft contains no valid diagram: preserve the document and sections while returning no diagram with its recorded verification outcome.
- A persistence failure occurs after drafting: mark the document failed with an inspectable error and do not expose a partially saved completed version.
- A retry or regeneration request races with another request: assign each accepted document a unique, consecutive repository-scoped version so history is not overwritten or duplicated.
- A request supplies a commit reference other than the repository's currently indexed commit: reject the request so the document is never labeled as describing evidence that was not used to create it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized repository owner to start architecture-document generation for a repository that is ready for grounded drafting.
- **FR-002**: The generation request MUST return without waiting for drafting to finish and MUST provide a document identifier, job identifier, repository-scoped version number, and initial pending status.
- **FR-003**: The system MUST create a distinct persisted document record for every accepted generation or regeneration request before background drafting begins.
- **FR-004**: The system MUST process accepted document-generation requests asynchronously and update the persisted document status as it enters retrieval, generation, verification, and a terminal completed or failed state.
- **FR-005**: The system MUST allow an authorized repository owner to poll a requested job and receive its job identifier, document identifier, current status, and any terminal error message.
- **FR-006**: The system MUST persist a completed document's ordered sections, markdown content, cited source-file paths, verification result and notes, and available architecture diagram together with the document version.
- **FR-007**: The system MUST calculate and persist an aggregate verification score for a completed document when verification outcomes are available.
- **FR-008**: The system MUST return the latest completed version by default, including its document metadata, ordered sections, cited source files, verification results, and diagram when available.
- **FR-009**: The system MUST let an authorized repository owner list document-version history with each version's identifier, version number, status, generation time, and verification score.
- **FR-010**: The system MUST let an authorized repository owner retrieve a specific historical version with the same content shape as the latest completed document.
- **FR-011**: A regeneration request MUST create the next repository-scoped version and MUST NOT overwrite, delete, or modify any earlier document version.
- **FR-012**: The system MUST associate the requesting user and the repository's currently indexed commit reference with each document version; it MUST accept an omitted commit reference or that indexed reference only, and reject any other supplied reference.
- **FR-013**: If any background drafting or persistence step fails, the system MUST record a terminal failed status and an inspectable error message for that document version.
- **FR-014**: The system MUST prevent documents from remaining indefinitely in a non-terminal status after processing stops or fails.
- **FR-015**: Every trigger, polling, latest-document, history, version, and regeneration operation MUST verify repository ownership before accessing or disclosing repository-scoped document data.
- **FR-016**: The system MUST preserve the drafting pipeline's grounded sections, citations, verification outcomes, and diagram as supplied; this feature MUST NOT introduce ungrounded content during persistence or retrieval.
- **FR-017**: When a generation request targets a repository with active document-generation work, the system MUST return that active document and job identifiers without creating a duplicate concurrent version.

### Key Entities *(include if feature involves data)*

- **Generated Document**: A repository-scoped, versioned architecture-document record that tracks its generation status, optional commit reference, requester, verification score, timing, and error details.
- **Document Section**: One ordered persisted section of a generated document, containing markdown content, cited source files, verification information, and an optional diagram.
- **Document Generation Job**: Background work associated with one generated-document version and used by clients to observe progress and terminal failure information.
- **Document Version History**: The ordered collection of generated-document versions for one repository, where earlier versions remain readable after regeneration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In end-to-end checks, 100% of accepted generation requests return a document identifier, job identifier, version, and pending status without waiting for document drafting to finish.
- **SC-002**: In end-to-end checks, 100% of successful document jobs show every applicable drafting stage in order and reach a completed status that can be retrieved by its owner.
- **SC-003**: In forced-failure checks, 100% of failed document jobs reach a failed status with a non-empty inspectable error message and no job remains stuck in a non-terminal status after processing ends.
- **SC-004**: In completed-document checks, 100% of returned sections preserve their persisted order, markdown content, cited source files, and verification outcome; available diagrams are returned with the same version.
- **SC-005**: In regeneration checks, 100% of accepted regenerations create a distinct next version while all prior versions remain retrievable and unchanged.
- **SC-006**: In authorization checks, 100% of document operations by non-owners are denied, and 100% of returned document and job data belongs to the requested repository.

## Assumptions

- The existing drafting pipeline can create a grounded architecture draft for a ready repository and reports section verification outcomes and an optional diagram.
- Generated-document and document-section storage already supports repository-scoped version history and ordered section persistence.
- The application already has an authenticated repository-scoped request pattern and background job infrastructure that this feature follows.
- The initial scope exposes the documented trigger, progress, retrieval, history, and regeneration interactions; a rendered documentation user interface and automatic commit-triggered regeneration are outside this phase.
- The latest document means the most recent completed version; pending or failed versions do not replace it as the default result.

## Out of Scope

- Changes to indexing, structural analysis, grounded retrieval, prompt design, drafting, or verification logic.
- Automatic generation triggered by repository commits or webhooks.
- A client-side documentation viewer, visual diffing interface, notifications, or scheduling.
- Editing generated document content manually or merging content between versions.
- Storing external-source content or adding claims beyond the grounded draft supplied by the existing pipeline.
