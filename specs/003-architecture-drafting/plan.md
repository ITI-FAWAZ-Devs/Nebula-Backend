# Implementation Plan: Grounded Architecture Drafting

**Branch**: `003-architecture-drafting` | **Date**: 2026-07-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-architecture-drafting/spec.md`

## Summary

Add an in-memory architecture-drafting pipeline that turns a repository's indexed evidence into a grounded, verified architecture overview. The pipeline is internal—it exposes no HTTP route, queue, or persistence in this phase. It orchestrates four sequential stages—structure planning, per-section retrieval + generation, per-section verification, and diagram generation—each powered by a dedicated, versioned prompt template injected into `GeminiService.generateContent`. Every generated section cites repository file paths drawn exclusively from `HybridRetrieverService` evidence, and an independent verification step checks each section's claims before the result is returned. The `ArchitectureDocModule` owns the new services; it depends on the existing `GeminiModule`, `ChromaModule`, `Neo4jModule`, and `PrismaModule` for retrieval and persistence infrastructure, and consumes `HybridRetrieverService` as an internal provider.

## Technical Context

**Language/Version**: TypeScript 5.7, target ES2021

**Primary Dependencies**: NestJS 11, Prisma 7, `chromadb` 3.5, `neo4j-driver` 6.2, Google Generative AI SDK (`@google/generative-ai`)

**Storage**: PostgreSQL 18 via Prisma (existing `GeneratedDoc`, `DocSection`, `DocStatus` models from Phase 1 migration—not used by this phase but present); Chroma collections named `repo-{repositoryId}`; existing Neo4j repository graph

**Testing**: Jest 29 with `ts-jest`; unit tests co-located under `src`; integration tests under `test`

**Target Platform**: Node.js NestJS backend service

**Project Type**: Single NestJS web service

**Performance Goals**: Full drafting pipeline (plan + generate + verify + diagram) completes in under 90 seconds for a mid-sized indexed repository (~200 files) at p95

**Constraints**: Reuse the stable Phase 1 hybrid-retrieval contract without modification. No HTTP endpoints, BullMQ jobs, persistence writes, or controller changes in this phase. Every claim in a section must be grounded in retrieved context; ungrounded claims are removed or the section is marked unverified. The section plan is derived from repository evidence, not from a fixed template. Templates are stored as separate `.ts` prompt-builder files, not inlined in service methods.

**Scale/Scope**: One repository-scoped drafting call returns an in-memory result. Phase 3 adds persistence, endpoints, and background processing.

## Constitution Check

### Pre-design

- **Ownership**: `ArchitectureDocModule` owns the new `DraftingOrchestratorService`, `StructurePlannerService`, `SectionGeneratorService`, `SectionVerifierService`, `DiagramGeneratorService`, and all prompt templates. `HybridRetrieverService` remains owned by `architecture-doc` (Phase 1). `GeminiService` in `GeminiModule` owns LLM calls. `PrismaService` owns the persistence boundary but is only used in this phase for repository metadata reads (no document writes).
- **Executable verification**: Unit tests mock `GeminiService` and `HybridRetrieverService` to verify planning, generation, verification, and diagram logic. A fixture-based test validates the seeded-hallucination scenario (SC-003). An integration test uses live Chroma and Neo4j stores with a small fixture repository.
- **Jobs and workspaces**: Not applicable—this phase starts no asynchronous work and creates no workspace.
- **Grounding**: Every section's content is derived exclusively from `HybridRetrieverService` evidence. The generation prompt instructs the LLM to cite repository file paths only. The verifier independently checks each claim and citation against the same context.
- **Tenant isolation**: Every retrieval call is scoped by `repositoryId` through the Phase 1 contract. The drafting orchestrator receives a `repositoryId` and passes it to every retrieval call. No cross-repository data mixing is possible.

### Post-design

PASS. The design reuses existing service boundaries (Gemini for LLM, Chroma/Neo4j via HybridRetrieverService for retrieval), adds no new storage clients, preserves repository filters in every retrieval call, and provides focused executable verification including the constitution-mandated seeded-hallucination fixture check. No constitutional exception or added complexity is required.

## Project Structure

### Documentation (this feature)

```text
specs/003-architecture-drafting/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── drafting-pipeline.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
src/
├── architecture-doc/
│   ├── architecture-doc.module.ts                  # ArchitectureDocModule
│   ├── hybrid-retriever.service.ts                 # Phase 1 — unchanged
│   ├── hybrid-retriever.service.spec.ts            # Phase 1 — unchanged
│   ├── drafting-orchestrator.service.ts            # Top-level pipeline orchestrator
│   ├── drafting-orchestrator.service.spec.ts       # Unit tests
│   ├── structure-planner.service.ts                # Repository-specific section planning
│   ├── structure-planner.service.spec.ts           # Unit tests
│   ├── section-generator.service.ts                # Per-section content generation
│   ├── section-generator.service.spec.ts           # Unit tests
│   ├── section-verifier.service.ts                 # Per-section verification
│   ├── section-verifier.service.spec.ts            # Unit tests
│   ├── diagram-generator.service.ts                # Architecture diagram generation
│   ├── diagram-generator.service.spec.ts           # Unit tests
│   ├── dto/
│   │   ├── hybrid-retrieval-context.dto.ts         # Phase 1 — unchanged
│   │   └── architecture-draft.dto.ts               # Draft result types
│   └── templates/
│       ├── structure-plan.prompt.ts                # Planning prompt builder
│       ├── section-generation.prompt.ts            # Generation prompt builder
│       ├── section-verification.prompt.ts          # Verification prompt builder
│       └── diagram-generation.prompt.ts            # Diagram prompt builder
├── gemini/
│   └── gemini.service.ts                           # Reused unchanged
├── chroma/
│   └── chroma.service.ts                           # Reused unchanged
├── neo4j/
│   └── neo4j.service.ts                            # Reused unchanged
└── prisma/
    └── prisma.service.ts                           # Reused unchanged (metadata reads only)

test/
└── drafting-pipeline.e2e-spec.ts                   # Live-store fixture integration test
```

**Structure Decision**: Five single-responsibility services within `architecture-doc` module, each with its own prompt template file. No new modules outside `architecture-doc`. No schema migration required—Phase 1 already added `GeneratedDoc`/`DocSection`/`DocStatus`, and this phase does not write to them. The `ArchitectureDocModule` registers `HybridRetrieverService` and imports `GeminiModule`, `ChromaModule`, `Neo4jModule`, and `PrismaModule`.

## Implementation Approach

1. **Create `ArchitectureDocModule`** in `src/architecture-doc/architecture-doc.module.ts`. Import `GeminiModule`, `ChromaModule`, `Neo4jModule`, and `PrismaModule`. Register `HybridRetrieverService`, `DraftingOrchestratorService`, `StructurePlannerService`, `SectionGeneratorService`, `SectionVerifierService`, and `DiagramGeneratorService`. Export `DraftingOrchestratorService` as the module's public API.

2. **Define draft result DTOs** in `src/architecture-doc/dto/architecture-draft.dto.ts`:
   - `SectionPlan`: unique key, title, purpose, retrieval topic
   - `DraftSection`: key, title, markdown body, cited source files, verification verdict (verified/unverified/removed), verification notes
   - `ArchitectureDiagram`: Mermaid source string, verification verdict, verification notes
   - `ArchitectureDraft`: repositoryId, ordered `DraftSection[]`, optional `ArchitectureDiagram`, section plan, source diagnostics

3. **Implement `StructurePlannerService`**: Accept a `repositoryId`. Call `HybridRetrieverService.retrieve` with a broad topic (e.g., "architecture overview of the repository") to get broad evidence. Read repository metadata from Prisma (name, owner, default branch). Build a prompt using `structure-plan.prompt.ts` that instructs the LLM to propose a repository-specific set of sections. Parse the structured JSON response into `SectionPlan[]`. Validate: discard entries with duplicate keys, missing keys, or empty titles. Return the validated plan.

4. **Implement `SectionGeneratorService`**: For each `SectionPlan`, call `HybridRetrieverService.retrieve` with the section's focused retrieval topic to get dedicated context. Build a prompt using `section-generation.prompt.ts` that instructs the LLM to write the section using only the provided file evidence and to cite repository file paths inline. Parse the response into a `DraftSection` with body and cited source files.

5. **Implement `SectionVerifierService`**: For each generated `DraftSection`, build a prompt using `section-verification.prompt.ts` that provides the section body, the cited files, and the same retrieved context used for generation. Instruct the LLM to independently check every material claim and citation. If a claim is unsupported, the verifier returns a rewritten body without that claim or marks the section unverified. If a citation does not match the provided evidence, the verifier rejects it. Allow one focused follow-up retrieval if the verifier identifies a specific claim that might be resolved with narrower evidence.

6. **Implement `DiagramGeneratorService`**: After all sections are verified, collect module relationship evidence from the retrieval results (the `relationships` and `moduleClusters` fields from `HybridRetrievalContext`). Build a prompt using `diagram-generation.prompt.ts` that instructs the LLM to generate a Mermaid flowchart or graph using only modules present in the evidence. Validate the output: parse Mermaid syntax, check that diagrammed modules exist in the evidence. If validation fails, return no diagram with a verification note.

7. **Implement `DraftingOrchestratorService`**: The top-level service that ties the pipeline together. Accept `repositoryId`. Call `StructurePlannerService.plan()` → for each section call `SectionGeneratorService.generate()` → for each section call `SectionVerifierService.verify()` → call `DiagramGeneratorService.generate()`. Return the assembled `ArchitectureDraft`. Handle partial failures: if planning produces no sections, return no draft with a reason; if all sections fail verification, return the unverified result; if the diagram fails, return the draft without a diagram.

8. **Prompt templates**: Each prompt builder in `src/architecture-doc/templates/` is a pure function that takes structured inputs (context, metadata, instructions) and returns a prompt string. Templates are independently versioned by their file content. They are not embedded in service logic.

9. **Unit tests**: For each service, test with mocked dependencies:
   - `StructurePlannerService`: valid plan parsing, duplicate-key rejection, empty-evidence handling
   - `SectionGeneratorService`: content generation with citations, empty-context handling
   - `SectionVerifierService`: verified pass-through, unsupported claim removal, unverified marking, follow-up retrieval
   - `DiagramGeneratorService`: valid Mermaid generation, no-evidence diagram omission, malformed-output handling
   - `DraftingOrchestratorService`: full pipeline flow, partial-failure scenarios
   - Seeded-hallucination fixture test (SC-003): supply unrelated context and verify claim removal/unverified marking

10. **Integration test** in `test/drafting-pipeline.e2e-spec.ts`: Use a small fixture repository seeded in Chroma and Neo4j. Run the full drafting pipeline and verify: every section has citations, citations exist in the fixture, the seeded-hallucination section is caught, diagram modules match evidence.

## Complexity Tracking

No constitutional violations or additional abstractions require justification.
