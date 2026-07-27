# Research: Persist Architecture Documents

## Decision: Reuse the existing generated-document schema without a migration

**Rationale**: `GeneratedDoc` already provides repository-scoped versions, lifecycle status, commit reference, requester, verification score, failure detail, and timestamps. `DocSection` already provides ordered content, citations, verification fields, and the versioned diagram. The existing unique/index constraints cover version history and active-document lookup.

**Alternatives considered**:

- Add a separate document-job table: rejected because it duplicates document status and polling data.
- Add a new diagram table: rejected because a diagram already belongs to its versioned section.

## Decision: Use the generated document ID as the BullMQ job ID

**Rationale**: The document is created before queueing and has a stable UUID. Setting BullMQ's custom job ID to that UUID gives clients one identifier for both polling and persisted lifecycle state, avoiding a new column or job table.

**Alternatives considered**:

- Store BullMQ's generated ID on `GeneratedDoc`: rejected as redundant for this one-job-per-document workflow.
- Use an ephemeral queue ID only: rejected because queue cleanup would break durable polling/history links.

## Decision: Return existing active work rather than enqueue duplicates

**Rationale**: The clarified specification requires one active document generation per repository. A serializable create-or-reuse transaction prevents duplicate versions under concurrent requests and makes the original request safely repeatable.

**Alternatives considered**:

- Reject active requests: rejected by the clarification; clients need the current tracking identifiers.
- Run concurrent versions: rejected because it wastes LLM capacity and complicates version allocation.

## Decision: Accept only the current indexed commit reference

**Rationale**: Grounded drafts are based on the repository's current indexed evidence. Accepting an arbitrary commit reference would label the document as describing content that was not retrieved.

**Alternatives considered**:

- Accept any commit: rejected because it can misrepresent the document's evidence.
- Ignore a supplied commit: rejected because callers need invalid input made explicit.

## Decision: Report drafting progress through an optional orchestrator callback

**Rationale**: The current drafting service is the only component that knows when retrieval, generation, and verification begin. A small optional callback lets the worker persist true progress without copying drafting behavior or introducing a new pipeline layer.

**Alternatives considered**:

- Infer stages in the worker around one opaque `draft()` call: rejected because it would report invented progress.
- Refactor all drafting into separate queued jobs: rejected because the feature needs one durable job and the existing pipeline is already sequential.

## Decision: Persist only publishable sections and calculate a section-level verification score

**Rationale**: Sections marked `removed` contain no publishable content. Persisting non-removed sections preserves the draft's grounded output. The current draft exposes a verdict per section, not per claim, so the verifiable aggregate is `verified sections / persisted sections`; no score is stored when there are no persisted sections.

**Alternatives considered**:

- Persist removed/empty sections: rejected because they add unusable content to the public document.
- Claim a claim-level score: rejected because claim-level data is not available from Phase 2.
