# Research: Code-Grounded Drafting

**Feature**: `006-code-grounded-drafting` | **Date**: 2026-08-03

## Research Task 1: Where to Load Code From

**Decision**: Read code from the repository's persistent on-disk clone at drafting time, resolving `Repository.localPath` first and re-cloning from the stored `cloneUrl` inside the drafting job when that path is missing or inaccessible.

**Rationale**: After a successful indexing run, `DocumentationPipeline` leaves the clone at `Repository.localPath` (and reuses it when present), so most drafts need no network work. When the clone is gone, re-cloning inside the job (which already runs in BullMQ with the authorized `userId` in its payload) restores the code source without forcing the user to re-index. This matches the user's chosen behavior (Q1=A) and the existing persistent-clone pattern.

**Alternatives considered**:
- **Read from the vector store**: Storing code snippets in ChromaDB at indexing time was rejected because it grows the store with content that may already be stale, changes the indexing pipeline (out of scope), and the user chose on-demand reading.
- **Fail drafting when the clone is missing**: Rejected as too brittle; a lost clone would break generation until re-indexing.
- **Description-only fallback when missing**: Rejected in favor of re-cloning per the clarified requirement.

---

## Research Task 2: How to Enrich Retrieval Context Without Breaking the Phase 1 Contract

**Decision**: Do not modify `HybridRetrieverService`. Add a dedicated `CodeContextLoaderService` that takes an existing `HybridRetrievalContext` and a resolved clone root path, and returns an enriched context whose `RetrievedFile` entries gain optional `codeContent`/`codeLoadError` fields.

**Rationale**: `HybridRetrieverService` is the stable Phase 1 boundary also used by agent RAG; changing its signature or behavior would ripple across features. The drafting stage services already own their contexts, so enrichment at the call sites is local and keeps retrieval (ranking, merging) untouched. New fields are optional and in-memory only.

**Alternatives considered**:
- **Extend `HybridRetrieverService.retrieve` with a code-loader hook**: Couples retrieval to drafting and changes the shared Phase 1 contract.
- **Read code inside the prompt templates**: Templates are pure functions without I/O; this would break their testability and versioning.
- **New retrieval method parallel to `retrieve`**: Duplicates the merge/ranking logic.

---

## Research Task 3: Bounding Code Context for Token Limits

**Decision**: Apply three configurable bounds per context: `codeContextMaxFiles` (default 12 files), `codeContextMaxCharsPerFile` (default 4000 chars), and `codeContextMaxTotalChars` (default 32000 chars). Files are processed in `combinedScore` order; per-file truncation slices to the char cap; the cumulative budget stops adding code once exhausted (descriptions remain for the rest).

**Rationale**: The drafting pipeline already bounds retrieval (`maxFiles: 25`) and the performance goal targets p95 under 90s for ~200-file repos. Local file reads are cheap; the dominant cost is prompt size. Explicit numeric caps keep prompts inside the model window for any supported repository size (SC-004) and are configurable, mirroring the existing `documentation.describeConcurrency` pattern.

**Alternatives considered**:
- **Line-count caps**: Char caps are simpler and match how tokenizers price input.
- **No cap**: Risks exceeding context windows on large repositories and violating the performance goal.
- **Embedding-selected snippets**: Over-engineered; the retrieved file set is already ranked.

---

## Research Task 4: Fallback When a File's Code Cannot Be Read

**Decision**: Per-file resilience (user's choice Q2=A): a file whose code cannot be loaded (missing path, binary, non-UTF-8, oversized) keeps its description evidence in the context, gets a `codeLoadError`, and drafting continues. When the whole clone cannot be resolved, the orchestrator continues with a fully description-only context.

**Rationale**: A single unreadable file should not abort a document; the limitation is surfaced via `codeLoadError` so consumers can see exactly which files lacked code (SC-006). This matches the pipeline's existing partial-availability philosophy (per-section `removed` handling, diagram omission) and the constitution's ban on silent fabrication — the fallback is explicit and inspectable, not hidden.

**Alternatives considered**:
- **Fail the stage on any read failure**: Too fragile for one bad file.
- **Threshold-based failure (e.g., fail when most files fail)**: Adds a rule the user did not request and complicates testing.

---

## Research Task 5: Cloning Semantics Inside the Drafting Job

**Decision**: A re-clone writes to a persistent destination `<workspaceRoot>/draft-<repositoryId>` and updates `Repository.localPath`, matching how `DocumentationPipeline` persists/reuses a clone. The drafting job reports its existing monotonic `DocStatus` stages and creates no transient workspace, so no additional workspace-cleanup step is introduced.

**Rationale**: Keeping the refreshed clone at `localPath` makes subsequent drafts (and re-documentation) faster and is consistent with the existing pipeline. The one-active-document invariant guarantees at most one concurrent re-clone per repository.

**Alternatives considered**:
- **Clone to a transient workspace and delete after drafting**: Wastes the persisted-clone benefit and introduces a cleanup contract that the current `DocumentationPipeline` precedent does not follow for persistent clones.
- **Reuse the analysis workspace path**: Those workspaces are cleaned up after indexing; relying on them would be incorrect.

---

## Research Task 6: Grounding Extension vs. the Constitution

**Decision**: Treat the repository's own source code as an additional authoritative grounding source for drafting, alongside Chroma/Neo4j evidence. The prompts require claims to be consistent with the code, citations must reference real paths, raw code is never persisted (FR-008), and unreadable code is recorded per file.

**Rationale**: The constitution's Principle III requires AI documentation to be grounded in retrieved context; adding the actual code is a strict strengthening of that guarantee (it is the ground truth the summaries describe). No new storage, authorization, or persistence surface is added, and the change is documented in the plan's Constitution Check as an intentional extension rather than a silent exception.
