# Feature Specification: Grounded Architecture Drafting

**Feature Branch**: `003-architecture-drafting`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Phase 2 — Prompt Design & LLM Generation Engine from Build-Drafting-Agent-PLAN.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive a Grounded Architecture Overview (Priority: P1)

When a contributor needs to understand an indexed repository, they can obtain an in-memory architecture overview whose sections explain the repository using only retrieved repository evidence and cite the source files that support each claim.

**Why this priority**: A trustworthy, useful first-read document is the feature's core value; an uncited or ungrounded overview cannot be relied upon.

**Independent Test**: Draft an overview for a fixture repository with known indexed evidence and verify every returned section contains a non-empty body, at least one cited existing file path, and a verification outcome.

**Acceptance Scenarios**:

1. **Given** an indexed repository with available repository metadata, **When** a draft is requested, **Then** the system returns an ordered in-memory set of architecture sections with titles, markdown bodies, cited source files, and verification outcomes.
2. **Given** a section's retrieved context supports a non-trivial statement, **When** that statement appears in the section, **Then** the section cites the supporting repository file path inline and in its source-file list.
3. **Given** a retrieved context does not support a claim, **When** a draft is produced, **Then** the claim is not presented as supported documentation.

---

### User Story 2 - Get a Repository-Specific Structure (Priority: P1)

When repositories have different architectures, contributors receive an overview structure tailored to the evidence in each repository rather than the same fixed set of sections.

**Why this priority**: A structure that reflects the actual repository makes the document easier to navigate and avoids documenting subsystems that do not exist.

**Independent Test**: Draft overviews for two fixture repositories with distinct detected concerns and confirm their section-key sets differ while every planned section has a purpose and a retrieval topic.

**Acceptance Scenarios**:

1. **Given** broad evidence from an indexed repository, **When** the draft structure is planned, **Then** each proposed section has a unique key, a title, a one-line purpose, and a focused retrieval topic.
2. **Given** a repository without evidence of a particular subsystem, **When** its structure is planned, **Then** no section is proposed solely because it belongs to a predefined template.
3. **Given** two repositories with materially different available evidence, **When** drafts are requested, **Then** their section-key sets may differ to reflect those differences.

---

### User Story 3 - Trust Verification to Catch Unsupported Content (Priority: P1)

When the drafting process produces a weak or unsupported section, the system separately verifies that section against the same evidence and either removes unsupported content or marks the section as unverified with an explanation.

**Why this priority**: Independent verification is the guardrail that prevents an authoritative-looking document from containing unsupported claims.

**Independent Test**: Supply a deliberately unrelated or empty context to a generated fixture section and confirm its unsupported claim is removed or the section is returned as unverified with verification notes.

**Acceptance Scenarios**:

1. **Given** a generated section and the context used to create it, **When** verification finds every material claim supported, **Then** the section is returned as verified.
2. **Given** a generated section that contains a claim unsupported by its context, **When** verification runs, **Then** the returned section either removes the claim or is explicitly unverified with a reason.
3. **Given** a claim that needs narrowly focused additional evidence, **When** the verifier requests a follow-up lookup, **Then** only the additional grounded evidence is used to reassess that claim.

---

### User Story 4 - See a Grounded System Diagram (Priority: P2)

When reading the overview, a contributor receives one architecture diagram that summarizes the modules evidenced by the repository relationships and does not introduce nonexistent modules.

**Why this priority**: A diagram accelerates orientation, but it must meet the same grounding standard as the written sections.

**Independent Test**: Draft an overview for a fixture repository, validate the returned diagram syntax, and compare every diagrammed module against the retrieved relationship evidence.

**Acceptance Scenarios**:

1. **Given** verified draft sections and module relationship evidence, **When** a diagram is generated, **Then** it uses a supported flowchart or graph form and contains only modules present in that evidence.
2. **Given** no module-level relationship evidence is available, **When** a draft is requested, **Then** the result clearly reports that a grounded architecture diagram cannot be produced rather than inventing one.

### Edge Cases

- Broad repository evidence is empty or insufficient: return no draft or a clearly unverified result with the reason; do not fabricate sections, citations, or a diagram.
- A planned section's dedicated lookup produces no relevant evidence: mark that section unverified or omit it, rather than generating unsupported prose.
- A generated citation is missing from the repository or is absent from the section's retrieved context: reject it from the final section and verify or fail the section accordingly.
- A planning response has duplicate, invalid, or incomplete section entries: discard invalid entries and require a usable unique section plan before generation continues.
- A verifier cannot resolve an unsupported claim after one focused follow-up lookup: retain the unverified result with clear notes rather than repeatedly expanding retrieval.
- Diagram output is malformed or includes a module absent from the relationship evidence: return no diagram and retain an explicit verification note.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST create an in-memory architecture-document draft for an indexed repository without persisting the draft or exposing it through a public endpoint.
- **FR-002**: The system MUST use a broad grounded repository context and available repository metadata to propose a repository-specific section plan.
- **FR-003**: Each planned section MUST have a unique stable key, title, one-line purpose, and a focused retrieval topic.
- **FR-004**: The system MUST derive the section plan from repository evidence and MUST NOT require a fixed, predetermined section list.
- **FR-005**: For each planned section, the system MUST obtain dedicated grounded repository context before generating its content.
- **FR-006**: Each generated section MUST include a markdown body, a list of cited source-file paths, and a verification verdict.
- **FR-007**: The system MUST instruct generation to make only claims supported by the section's provided context and to cite a repository file path inline for every non-trivial claim.
- **FR-008**: The system MUST reject, remove, or mark unverified any cited path that does not exist in the repository or is unsupported by the context used for that section.
- **FR-009**: The system MUST perform a separate verification step for every generated section using the same grounded context that was used to generate that section.
- **FR-010**: When verification identifies an unsupported claim, the system MUST either return a rewritten section without that claim or return the section as unverified with clear verification notes.
- **FR-011**: The verifier MAY perform one focused follow-up retrieval for a section only when additional evidence could resolve a specific claim; any follow-up result MUST be grounded in the same repository.
- **FR-012**: The system MUST produce one architecture diagram from the final section set and available module relationship evidence.
- **FR-013**: The diagram MUST use valid Mermaid flowchart or graph syntax and MUST reference only modules represented in the retrieved relationship evidence.
- **FR-014**: The system MUST retain the section plan, generation instructions, verification instructions, and diagram instructions as independently versioned reusable templates rather than embedding them in orchestration logic.
- **FR-015**: The system MUST preserve repository isolation throughout planning, retrieval, generation, verification, citation validation, and diagram generation.
- **FR-016**: The system MUST provide a deterministic fixture-based check that proves verification catches a deliberately seeded unsupported section generated from unrelated or empty context.

### Key Entities *(include if feature involves data)*

- **Architecture Draft**: The in-memory, ordered result for one repository, containing planned and generated sections plus an optional verified architecture diagram.
- **Section Plan**: A repository-specific proposed section, identified by a unique key and containing a title, purpose, and focused retrieval topic.
- **Draft Section**: One generated document section with markdown content, cited source files, a verification verdict, and verification notes when applicable.
- **Verification Verdict**: The outcome of independently checking a section's material claims and citations against its retrieved evidence.
- **Architecture Diagram**: A Mermaid representation of modules and relationships that are present in grounded repository relationship evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In fixture-based checks, 100% of successfully returned draft sections contain at least one cited file path, and every cited path exists in the relevant repository.
- **SC-002**: In fixture-based checks using two repositories with different architectural evidence, the generated section-key sets differ whenever their detected concerns differ.
- **SC-003**: In the seeded-hallucination fixture, 100% of deliberately unsupported sections are either rewritten without the unsupported claim or returned as unverified with verification notes.
- **SC-004**: In fixture-based checks, 100% of returned diagrams parse as valid Mermaid flowcharts or graphs and contain no modules absent from the retrieved relationship evidence.
- **SC-005**: In fixture-based checks, 100% of material claims in sections marked verified have at least one supporting cited repository file.
- **SC-006**: In tenant-isolation checks, 100% of draft content, citations, and diagram modules originate only from the requested repository.

## Assumptions

- Repositories have completed the existing semantic indexing and structural analysis needed to provide grounded retrieval context.
- Phase 1 supplies a stable retrieval contract and sufficiently rich module relationship evidence for section-level drafting.
- Available repository metadata may include the repository name, primary language, and detectable entry points; missing metadata does not prevent a grounded draft.
- The intended initial output is an architecture overview for contributors, not a full hierarchy of independently generated subsystem pages.
- A section that cannot be grounded is safer to omit or mark unverified than to present as complete documentation.
- Persistence, public access, background processing, version history, and regeneration are deferred to Phase 3.

## Out of Scope

- Persisting drafts, sections, diagrams, or verification outcomes.
- Public REST endpoints, authorization flows, job queues, status polling, and document regeneration.
- Changes to repository indexing, structural analysis, or the grounded-retrieval contract established by Phase 1.
- Generating architecture claims from external sources or from repository content not supplied through grounded retrieval.
- Building a user interface for rendering markdown or Mermaid diagrams.
