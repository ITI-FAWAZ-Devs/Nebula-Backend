# Feature Specification: Code-Grounded Drafting

**Feature Branch**: `006-code-grounded-drafting`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "I want the docs generation process to have the code into its context to give more valid answers."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate Sections From Real Code (Priority: P1)

An authorized repository owner requests an architecture document and receives sections whose claims, terminology, and examples are grounded in the actual source code of the cited files rather than in short AI-generated file summaries alone.

**Why this priority**: File summaries omit the concrete details (function names, exports, configs, control flow) that make architecture documentation accurate. Reading real code is the direct fix for vague or incorrect generated content.

**Independent Test**: Draft a fixture repository whose stored file descriptions are deliberately vague, then verify that each generated section accurately names symbols and behaviors that are present only in the actual source code, and that every non-trivial claim matches that code.

**Acceptance Scenarios**:

1. **Given** a repository ready for drafting, **When** the drafting pipeline generates a section for a retrieval topic, **Then** the model receives the source code of the retrieved evidence files alongside their descriptions, and the section's non-trivial claims are consistent with that code.
2. **Given** a section that cites a file path, **When** the section is generated, **Then** the cited path refers to a file whose code was loaded into the generation context.
3. **Given** a file whose content exceeds the allowed snippet size, **When** it is included in evidence, **Then** the model receives a bounded, representative portion of that file rather than an unbounded upload.

---

### User Story 2 - Verify Claims Against Real Code (Priority: P1)

The documentation verifier checks each generated section's claims against the real source code of the cited and retrieved files, so unsupported or invented statements are caught or rewritten before the document is completed.

**Why this priority**: Verification is the last defense against hallucinated content. Giving the verifier real code makes its support checks meaningful instead of comparing summaries to summaries.

**Independent Test**: Draft a fixture section containing a claim that is contradicted by the actual code of a cited file, then confirm the verification stage either rewrites the claim to match the code or marks the section unverified with an explanatory note.

**Acceptance Scenarios**:

1. **Given** a generated section and its evidence files, **When** the pipeline verifies it, **Then** the verifier sees the same real code context used for generation.
2. **Given** a claim that matches the cited file's code, **When** verification runs, **Then** the claim is retained and the section can reach a verified outcome.
3. **Given** a claim that is absent from or contradicted by the cited file's code, **When** verification runs, **Then** the claim is removed or the section is marked unverified with a note referencing the missing support.

---

### User Story 3 - Plan Sections Using Code (Priority: P2)

The structure planner uses code evidence for the repository's most relevant files so the proposed section plan reflects the actual architecture (real modules, entry points, and data flows) instead of template guesses.

**Why this priority**: A plan built from real code yields more specific, repository-shaped sections, which then produce more accurate documents.

**Independent Test**: Draft a fixture repository and verify that the planned sections reference modules and entry points that are identifiable only from the source code, and that the returned plan is reproducible across runs.

**Acceptance Scenarios**:

1. **Given** a repository ready for drafting, **When** the pipeline plans sections, **Then** the planner context includes code for the most relevant retrieved files alongside their descriptions.
2. **Given** an architecture concern that is visible only in code, **When** the planner runs, **Then** a corresponding section is proposed rather than omitted.
3. **Given** the same repository state, **When** the planner runs twice, **Then** the produced section plan is deterministic.

---

### User Story 4 - Continue When Code Is Unavailable (Priority: P2)

When the repository's source code cannot be read for some or all retrieved files, the drafting pipeline still produces a document using the existing description-based evidence, and the limitation is visible in the outcome rather than silent.

**Why this priority**: Indexing stores only summaries; disk state can change or the clone can be lost. The pipeline must recover by re-cloning when possible and must never silently pretend code was used when it was not.

**Independent Test**: Draft a fixture repository whose on-disk code is unavailable, and verify the pipeline re-clones before loading code; separately force a file to be unreadable and verify the run completes with a per-file limitation note.

**Acceptance Scenarios**:

1. **Given** a repository whose stored clone is missing or inaccessible, **When** drafting runs, **Then** the pipeline re-clones the repository before loading code evidence.
2. **Given** a file whose code cannot be read, **When** drafting runs, **Then** the file's description evidence remains in context, a per-file limitation note is recorded, and the run continues.

### Edge Cases

- The repository's local clone path no longer exists or is not accessible at drafting time.
- A retrieved file is renamed, deleted, or changed between indexing and drafting.
- A file is binary, too large, or not UTF-8 readable, so its content cannot be loaded.
- A file's content exceeds the per-file or per-context token budget.
- The combined code context for a single stage exceeds the model's prompt window.
- Code exists only for some of the retrieved files.
- A section cites a file whose code failed to load; the file's description evidence remains, the citation is retained, and a per-file limitation note is recorded.
- Drafting runs for a repository that was never indexed locally (no stored clone); the drafting job re-clones the repository before loading code.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST include the actual source code of retrieved evidence files in the drafting context used to generate documentation sections, alongside each file's description.
- **FR-002**: The system MUST include the same code evidence in the verification stage so that generated claims are checked against the real code of the cited and retrieved files.
- **FR-003**: The system MUST include code evidence for the most relevant retrieved files in the structure-planning stage so proposed sections reflect the repository's real architecture.
- **FR-004**: The system MUST bound the code evidence delivered to the model with a per-file limit and a per-context total limit, and MUST trim or skip content that exceeds those limits.
- **FR-005**: The system MUST load code from the repository's stored local clone at drafting time; when that clone is missing or inaccessible, the system MUST re-clone the repository from its stored clone URL inside the drafting job before loading code evidence.
- **FR-006**: For a file whose code cannot be loaded (missing path, binary, oversized, or unreadable), the system MUST keep that file's description-based evidence in context, MUST record a per-file limitation note so the limitation is inspectable, and MUST continue drafting without aborting the stage.
- **FR-007**: The system MUST keep every existing grounding guarantee: citations must reference real repository file paths, and no claim may be presented as supported when the evidence does not support it.
- **FR-008**: The system MUST NOT persist raw code content into generated documents; persisted sections contain prose, citations, verification results, and diagrams only.
- **FR-009**: The system MUST preserve the existing drafting performance target and MUST NOT exceed the model context window for any supported repository size.
- **FR-010**: The system MUST keep the existing repository-ownership enforcement unchanged; no new user-facing authorization surface is added by this feature.

### Key Entities *(include if feature involves data)*

- **Retrieved File Evidence**: An in-memory evidence record that already carries a file path, description, and ranking signals; this feature adds an optional bounded source-code snippet loaded from the repository's clone.
- **Code Loader**: Internal capability that resolves the repository's on-disk clone, reads file contents, applies per-file and per-context bounds, and reports per-file loading status.
- **Drafting Context**: The evidence bundle sent to the model for planning, generation, and verification; it now carries code snippets in addition to descriptions, relationships, and clusters.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In fixture-repository checks, 100% of generated sections whose claims are testable against code are consistent with the actual code of their cited files.
- **SC-002**: In fixture checks, 100% of cited file paths resolve to files whose code was loaded into the generation context (or the section records why a citation could not be code-verified).
- **SC-003**: In verification checks, 100% of deliberately fabricated claims are either rewritten to match code or cause the section to be marked unverified with an explanatory note.
- **SC-004**: In performance checks, drafting completes within the existing p95 target for a mid-sized indexed repository, and no stage exceeds the model context window.
- **SC-005**: In persistence checks, 0% of stored documents contain raw source code; only prose, citations, verification results, and diagrams are persisted.
- **SC-006**: In unavailable-code checks, the pipeline re-clones the repository when its stored clone is missing, and records an inspectable per-file limitation note for every file whose code could not be loaded while still completing the draft.

## Assumptions

- After a successful indexing run, the repository's local clone remains available on disk at the stored clone path, so drafting can usually read code without re-cloning.
- When the clone is missing, the drafting job re-clones from the repository's stored clone URL using the owner's existing GitHub token infrastructure; the repository must remain importable from that URL.
- File descriptions in the vector store remain the ranking source; code content augments context but does not change retrieval ranking or the evidence merge logic.
- A per-file snippet limit and a per-context total limit keep prompts within model limits; reasonable defaults are chosen for both and made configurable.
- Code context is computed at drafting time and exists only in memory; it is never stored in the database or returned by API responses.
- The drafting pipeline's existing failure semantics for unavailable sources continue to apply; this feature only enriches the evidence that reaches the model.
- No database schema change or migration is required for this feature.

## Out of Scope

- Changing retrieval ranking, embedding, or the evidence merge algorithm to prioritize code content.
- Storing source code (or code snippets) in the vector store or database at indexing time.
- Syntax highlighting, code formatting, or rendering code in a client-side viewer.
- Modifying which files are indexed or which files are retrieved for each stage.
- Any change to the public API contract or repository-ownership authorization rules.
