# Research: Grounded Architecture Drafting

**Feature**: `003-architecture-drafting` | **Date**: 2026-07-26

## Research Task 1: Structured LLM Output for Section Planning

**Decision**: Use Gemini's `generateContent` with a JSON-schema instruction in the prompt rather than the Gemini structured-output/tool-use API.

**Rationale**: The existing `GeminiService.generateContent` (via `@google/generative-ai` SDK) already works with the `gemini-2.5-flash` model. Adding `responseMimeType: 'application/json'` and `responseSchema` to the generation config would require modifying `GeminiService`'s internal model configuration, which belongs to a separate service boundary. Instead, the prompt templates explicitly instruct the model to return JSON and include the schema inline. A lightweight JSON parse + validation layer in each service handles malformed responses with one retry.

**Alternatives considered**:
- **Gemini structured output API** (`responseSchema`): Would guarantee JSON conformance but requires extending `GeminiService` with a new method that accepts schema configuration. This crosses the `GeminiModule` ownership boundary for a Phase 2 feature. Deferred to a future GeminiService enhancement.
- **OpenAI-style function calling**: Not applicable—project uses Google Generative AI SDK exclusively.

---

## Research Task 2: LLM Prompt Strategy for Grounded Generation

**Decision**: Use a two-shot approach—one broad retrieval for structure planning, then per-section focused retrieval for generation. Each prompt explicitly lists the available file evidence as structured context and instructs the model to cite only from that context.

**Rationale**: A single monolithic prompt with all repository evidence would exceed token limits for large repositories and dilute relevance. The Phase 1 `HybridRetrieverService` already supports topic-based retrieval with configurable limits, making per-section focused queries natural. The prompt templates enforce grounding by:
1. Presenting evidence as a numbered list of `[filePath]: description` entries
2. Instructing the model to cite file paths inline using `[filePath]` notation
3. Stating that claims without evidence support must not appear

**Alternatives considered**:
- **Single retrieval, full context**: Token limits and relevance dilution make this impractical for repositories with 100+ files.
- **Multi-turn conversation with the LLM**: More complex orchestration, harder to test deterministically, and the stateless `generateContent` API is simpler.

---

## Research Task 3: Verification Strategy

**Decision**: Use a separate LLM call per section that receives the same context used for generation and independently checks each material claim and citation.

**Rationale**: The spec requires "a separate verification step for every generated section using the same grounded context" (FR-009). Using the same context ensures the verifier has exactly the same evidence basis. The verifier prompt instructs the LLM to:
1. List each material claim in the section
2. For each claim, identify the supporting evidence from the provided context
3. Flag unsupported claims
4. Check that every cited file path appears in the provided context
5. Return a verdict (verified/unverified) with notes

One follow-up retrieval is allowed (FR-011) if the verifier identifies a specific claim that might be resolvable with narrower evidence. The follow-up uses `HybridRetrieverService` with a more focused topic derived from the claim.

**Alternatives considered**:
- **Embedding-based similarity check** (compare claim embeddings against context): Too coarse-grained for citation validation and would miss logical grounding issues.
- **No separate verification** (self-check during generation): The spec explicitly requires independent verification (FR-009), and self-verification in the same prompt is less reliable.

---

## Research Task 4: Mermaid Diagram Generation from Graph Evidence

**Decision**: Generate Mermaid `flowchart TD` syntax from the `relationships` and `moduleClusters` returned by `HybridRetrievalContext`. Validate by parsing the output as Mermaid (regex-based syntax check for node and edge declarations) and cross-referencing diagrammed modules against the evidence.

**Rationale**: The spec requires valid Mermaid flowchart or graph syntax (FR-013) with only modules from retrieved evidence (FR-013). The `HybridRetrievalContext.relationships` field contains `FileRelationship[]` with `fromFilePath`, `toFilePath`, and `type`, and `moduleClusters` contains `{ name, filePaths[] }[]`. These provide the raw module-to-module relationships. The diagram prompt:
1. Receives the relationship evidence as a structured list
2. Instructs the LLM to group files into logical modules (using clusters when available)
3. Generates Mermaid `flowchart TD` with module nodes and dependency edges
4. Is validated post-generation: check that every node label maps to an evidence module/cluster

**Alternatives considered**:
- **Deterministic graph rendering** (no LLM, direct relationship-to-Mermaid mapping): Would produce accurate but unhelpful diagrams (one node per file path). The LLM adds value by grouping files into logical modules and labeling edges meaningfully.
- **D3/SVG rendering**: The spec explicitly requires Mermaid syntax (FR-013).

---

## Research Task 5: Error Handling and Partial Availability

**Decision**: The orchestrator handles each failure mode explicitly:
- **Empty evidence from broad retrieval** (planning stage): Return no draft with a reason ("Insufficient indexed evidence for architecture planning").
- **Section-level generation failure**: Skip the section; include it in the result as a failed entry with an error note.
- **Section-level verification failure** (LLM error, not a grounding failure): Return the section as unverified with the error as a verification note.
- **Diagram generation failure**: Return the draft without a diagram, with a note explaining the omission.
- **HybridRetrieverService throws** (both stores unavailable): Propagate the error; the pipeline cannot proceed without any retrieval.
- **Repository not found or not indexed**: Fail early with a clear error before any LLM calls.

**Rationale**: The spec's edge cases (lines 74–81) explicitly require graceful degradation: no fabricated sections, clear unverified marking, and explicit failure for unresolvable issues. The orchestrator wraps each stage in error handling that preserves partial results.

**Alternatives considered**:
- **All-or-nothing approach** (fail the entire draft on any section error): Too fragile; a single LLM timeout would discard all work.
- **Retry loops for verification failures**: The spec limits follow-up to one retrieval (FR-011); repeated retries would violate this.

---

## Research Task 6: Template Versioning and Reusability (FR-014)

**Decision**: Store each prompt template as an exported pure function in `src/architecture-doc/templates/*.prompt.ts`. Each function takes structured inputs (context, metadata, constraints) and returns a prompt string. Templates are versioned by their file content in source control.

**Rationale**: FR-014 requires "independently versioned reusable templates rather than embedding them in orchestration logic." Pure functions in separate files satisfy this: they are independently importable, testable, and their version history is tracked by Git. They can be swapped or A/B tested without modifying service logic.

**Alternatives considered**:
- **Handlebars/Mustache template files**: Adds a template engine dependency and loses TypeScript type checking on template inputs.
- **Database-stored templates**: Overengineered for Phase 2, which has no persistence requirement.
- **Constants in service files**: Violates FR-014's independence requirement.
