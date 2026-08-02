# Feature Specification: Agent RAG Pipeline

**Feature Branch**: `005-agent-rag`

**Created**: 2026-07-30

**Status**: Draft

**Input**: Multi-phase plan for a Gemini function-calling agent over frozen graph/vector retrieval tools with Redis sessions, SSE streaming, and an evaluation harness.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask a Grounded Repository Question (Priority: P1)

An authorized repository owner opens an agent session and asks a question about their indexed repository. The system retrieves evidence via frozen vector/graph tools, synthesizes an answer grounded only in that evidence, streams the answer, and returns structured citations.

**Why this priority**: This is the core product value of the agent surface.

**Independent Test**: Create a session for a fixture repository with Chroma + Neo4j evidence, post a conceptual question, receive SSE tokens, and verify the final `done` event includes citations and a non-empty answer.

**Acceptance Scenarios**:

1. **Given** an owned indexed repository, **When** the owner creates a session and posts a question, **Then** the system streams answer tokens and ends with structured citations.
2. **Given** insufficient context, **When** the agent synthesizes, **Then** the answer admits lack of knowledge rather than inventing repository details.
3. **Given** a user who does not own the repository, **When** they try to create a session or post a message, **Then** access is denied.

---

### User Story 2 - Structural Follow-ups with Session Memory (Priority: P1)

After an answer that cited graph entities, the owner asks a follow-up (e.g. callers of a previously discussed method) without restating the entity. The planner receives recent `citedNodeIds` and can resolve the follow-up.

**Why this priority**: Multi-turn Q&A is required for real exploration.

**Independent Test**: Complete one turn that cites nodeIds, ask a follow-up referencing “that method”, and verify the planner input includes recent nodeIds and the second answer remains grounded.

---

### User Story 3 - Evaluate Retrieval/Prompt Changes (Priority: P2)

A developer runs a fixed eval fixture set of 15–20 questions after changing retrieval or prompts and sees pass/fail per intent shape.

**Why this priority**: Prevents silent regressions.

**Independent Test**: Run the eval runner against fixtures and confirm scoring for contains/citation checks.

### Edge Cases

- Empty Chroma collection or missing Neo4j graph: agent still responds with an honest “don’t know” / indexing guidance.
- Planner requests unknown tools: executor ignores them safely.
- Planner loop attempts more than 3 iterations: hard-capped.
- Graph expansion would explode: hop and node-count caps truncate results.
- Redis unavailable for sessions: create/get session fails clearly; tool cache degrades to uncached.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Freeze tools to `vector_search`, `hybrid_search`, `getDefinition`, `getCallers`, `getCallees`, `getImplementations`, `getFileContext`, `getModuleOverview` — no free-text Cypher.
- **FR-002**: All retrieval paths MUST return the shared `RetrievalHit` shape `{ nodeId, type, filePath, lineRange, content, score, source }`.
- **FR-003**: Context builder MUST enforce an 8k-token retrieved-context budget before synthesis.
- **FR-004**: Planner MUST use Gemini function calling with a max of 3 iterations.
- **FR-005**: Synthesizer MUST restrict answers to provided context, require inline citations, and refuse when uncovered.
- **FR-006**: Sessions MUST store last 3–5 turns (question, answer, citedNodeIds) in Redis keyed by session ID.
- **FR-007**: Message endpoint MUST stream synthesizer output via SSE; planning/tools stay server-side.
- **FR-008**: Final SSE `done` event MUST include structured citations and citedNodeIds.
- **FR-009**: Graph tool results MUST be cacheable per `(repositoryId, tool, args)` with a short TTL.
- **FR-010**: Existing architecture-doc `HybridRetrieverService` and `/ask` MUST remain unchanged.

### Key Entities

- **RetrievalHit**: shared evidence unit
- **AgentSession**: Redis-backed conversation state
- **AgentCitation**: structured source reference for the frontend

## Success Criteria *(mandatory)*

- **SC-001**: Unit tests cover vector/graph/hybrid mapping, context truncation, and sourceLocation normalization.
- **SC-002**: Eval fixture covers conceptual, structural, comparative, and doc-summary intents (≥15 items).
- **SC-003**: Agent module does not modify architecture-doc hybrid retrieval or AskService.
