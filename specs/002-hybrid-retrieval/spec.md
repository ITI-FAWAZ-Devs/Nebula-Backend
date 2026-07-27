# Feature Specification: Hybrid Repository Retrieval

**Feature Branch**: `002-hybrid-retrieval`

**Created**: 2026-07-25

**Status**: Draft

**Input**: User description: "Phase 1 — Hybrid Retrieval Engine & Data Model from Build-Drafting-Agent-PLAN.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Retrieve Grounded Repository Context (Priority: P1)

When creating architecture documentation, the drafting workflow can request one consolidated set of relevant repository evidence for a topic so that later content is grounded in both file meaning and file relationships.

**Why this priority**: This is the foundation for trustworthy generated documentation; without it, later drafting cannot reliably explain how repository parts work together.

**Independent Test**: With an indexed repository and a topic such as "authentication flow", request context and confirm it contains ranked, unique files with descriptions, relevance scores, and their relevant repository relationships.

**Acceptance Scenarios**:

1. **Given** an indexed repository with semantic descriptions and repository relationships, **When** the drafting workflow requests context for a free-text topic, **Then** it receives one ranked context containing relevant files and their relationship evidence.
2. **Given** a request that starts from one or more file paths, **When** context is retrieved, **Then** the requested existing files are included as retrieval seeds and their relevant relationships are returned.
3. **Given** the same file is found by both semantic and relationship evidence, **When** the context is assembled, **Then** it appears once with a relevance ranking that reflects both signals.

---

### User Story 2 - Discover Connected Files (Priority: P1)

When a topic strongly identifies one file, the drafting workflow receives that file's direct connected files even when those connected files would not independently rank highly by meaning alone.

**Why this priority**: Architecture documentation needs connection evidence, not merely a list of similarly described files.

**Independent Test**: Use an indexed fixture repository in which a highly relevant file directly relates to a low-similarity file; retrieve context for the highly relevant file and confirm the connected file is included.

**Acceptance Scenarios**:

1. **Given** a relevant seed file with direct import, export, or dependency relationships, **When** its context is retrieved, **Then** its direct related files are included with the relationship type.
2. **Given** a relevant seed file that belongs to a module cluster, **When** its context is retrieved, **Then** the cluster membership is available in the returned context.
3. **Given** retrieval includes connected files reached through allowed relationship expansion, **When** the context is returned, **Then** each returned relationship identifies its source, destination, and relationship type.

---

### User Story 3 - Preserve Document Storage Foundations (Priority: P2)

When the documentation workflow later creates an architecture document, it has durable storage capable of preserving each document version, its ordered sections, source references, verification outcome, processing status, and failure details.

**Why this priority**: Versioned, inspectable document storage is required before generated documents can safely be persisted in a later phase.

**Independent Test**: Create a document record with ordered section records for an indexed repository, retrieve it, and confirm the version, lifecycle status, sections, source-file references, and verification fields are retained.

**Acceptance Scenarios**:

1. **Given** a repository with no generated architecture document, **When** a first document record is stored, **Then** it is assigned version 1 and an initial processing status.
2. **Given** an existing document version, **When** a later version is stored for the same repository, **Then** both versions remain available and their version values are unique within that repository.
3. **Given** an architecture document with multiple sections, **When** its sections are retrieved, **Then** their declared display order, source-file references, verification result, notes, and optional diagram content are retained.

### Edge Cases

- A retrieval request names a file path that is absent from the indexed repository: return the available context without fabricating that file or its relationships, and clearly identify the missing seed.
- Semantic evidence is unavailable while relationship evidence is available, or vice versa: return the available grounded evidence and identify the unavailable source rather than inventing merged results.
- A file is encountered repeatedly through multiple paths or signals: return one file entry while retaining the applicable evidence and relevance contribution.
- A relationship points to a file no longer represented in the semantic index: retain the relationship evidence without inventing a description or similarity score.
- A repository has no indexed evidence for the topic: return an empty, valid context with an explicit no-evidence outcome.
- A document section key is duplicated within one document version, or a document version is duplicated within one repository: reject the conflicting record.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide one stable retrieval contract that accepts a repository identifier and either a free-text topic, one or more seed file paths, or both.
- **FR-002**: For an indexed repository, the system MUST return a single retrieval context that combines relevant file-description evidence with repository-relationship evidence.
- **FR-003**: Each returned file entry MUST include its repository path, available description, semantic relevance score when available, and all retained relevance evidence.
- **FR-004**: The system MUST use the highest-ranked semantic matches as seeds for repository relationship expansion.
- **FR-005**: The system MUST include direct related files of retrieval seeds, even when those files are not independently high-ranking semantic matches.
- **FR-006**: The system MUST support a bounded relationship expansion of one or two hops and expose the resulting relationship edges and module-cluster membership when available.
- **FR-007**: The system MUST de-duplicate returned files and relationships while preserving enough source evidence to explain their ranking.
- **FR-008**: The system MUST favor files supported by both semantic and relationship evidence over otherwise comparable files supported by only one evidence source.
- **FR-009**: The system MUST return an explicit, valid no-evidence result when neither evidence source produces grounded results for a request.
- **FR-010**: The system MUST isolate repository evidence so a retrieval request can return only data belonging to the requested repository.
- **FR-011**: The system MUST make document storage available for a generated architecture document with repository ownership, version, lifecycle status, optional source revision, optional initiating user, generation metadata, verification score, timestamps, and an inspectable failure message.
- **FR-012**: The system MUST support the statuses `PENDING`, `RETRIEVING`, `GENERATING`, `VERIFYING`, `COMPLETED`, and `FAILED` for a generated document.
- **FR-013**: The system MUST retain ordered document sections with a unique key per document version, title, markdown content, cited source-file paths, verification result and notes, and optional diagram content.
- **FR-014**: The system MUST preserve prior document versions for a repository and enforce that each version number is unique within that repository.
- **FR-015**: The system MUST delete a document's sections when that document is deleted, and delete a repository's generated documents when that repository is deleted.

### Key Entities *(include if feature involves data)*

- **Hybrid Retrieval Context**: The single grounded evidence package for a repository topic or file seed set; contains ranked, unique files, their descriptions and relevance evidence, relationship edges, cluster memberships, and retrieval diagnostics.
- **Retrieved File**: A repository file included in the context, identified by path and enriched with any available description, semantic relevance, relationship evidence, and combined ranking.
- **Repository Relationship**: A directed connection between repository files, including relationship type and hop distance from a retrieval seed.
- **Generated Document**: A versioned architecture-document record for one repository, including lifecycle status, generation and verification metadata, timing, and any failure detail.
- **Document Section**: An ordered, uniquely keyed portion of one generated document that holds its content, source-file references, verification result, notes, and optional diagram.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a representative mid-sized indexed repository, at least 95% of retrieval requests complete within 3 seconds.
- **SC-002**: In the fixture repository, 100% of retrievals anchored on a known file include that file's direct related files, including a related file that is outside the semantic top matches.
- **SC-003**: In automated retrieval checks, every returned context has zero duplicate file paths and zero duplicate relationship edges.
- **SC-004**: In automated checks using known fixture evidence, files supported by both evidence sources rank ahead of otherwise comparable files supported by one source alone.
- **SC-005**: A newly initialized data environment can store and retrieve a generated document and its ordered sections, while rejecting duplicate versions for the same repository and duplicate section keys for the same document.
- **SC-006**: 100% of retrieval results expose only evidence from the requested repository in tenant-isolation checks.

## Assumptions

- The repository has already completed semantic indexing and structural analysis before retrieval is requested.
- A representative mid-sized repository has a sufficiently complete index to support the 3-second target; detailed capacity limits will be defined during planning.
- One or two relationship hops are sufficient to ground an architecture-document section without overwhelming it with unrelated files.
- The later drafting workflow is the primary consumer of the retrieval contract; this phase does not expose a public endpoint or generate document content.
- Existing repository authorization and ownership rules remain the authority for access to repository-scoped data.
- Existing data stores are available to hold generated-document records and their sections; this phase establishes only the persistent data model, not document-generation workflows.

## Out of Scope

- Generating, verifying, or rendering architecture-document prose or diagrams.
- Public REST endpoints, background-job triggering, polling, and regeneration workflows.
- Re-indexing repositories or changing the existing semantic-indexing and structural-analysis pipelines.
- Per-file confidence-history storage beyond the evidence needed for context ranking and document section citations.
