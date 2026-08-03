# Implementation Plan: Code-Grounded Drafting

**Branch**: `006-code-grounded-drafting` | **Date**: 2026-08-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-code-grounded-drafting/spec.md`

## Summary

Enrich the existing architecture-drafting pipeline so the model receives the actual source code of its retrieved evidence files, not only their stored descriptions. A new `CodeContextLoaderService` resolves the repository's on-disk clone (re-cloning from the stored URL when the clone is missing or inaccessible, using the job's `userId`), reads bounded code snippets for the retrieved files, and attaches them to each `HybridRetrievalContext`. The structure-planning, section-generation, and section-verification prompt templates embed that code evidence and require claims to be grounded in it. Code is added to in-memory evidence only and is never persisted; per-file read failures keep the description-based evidence and record an inspectable `codeLoadError`.

## Technical Context

**Language/Version**: TypeScript 5.7, target ES2021

**Primary Dependencies**: NestJS 11, Prisma 7, `simple-git` (already used by `GitService`), `@nestjs/config`

**Storage**: PostgreSQL 18 through Prisma (`Repository.localPath`, `Repository.cloneUrl`, `Repository.defaultBranch`); the repository's on-disk clone; no schema change

**Testing**: Jest 29 with `ts-jest`; unit specs co-located in `src`; endpoint/integration specs in `test`

**Target Platform**: Node.js NestJS backend service

**Project Type**: Single NestJS web service

**Performance Goals**: Keep drafting at its existing p95 target (under 90 seconds for a mid-sized indexed repository of ~200 files). Code reads are bounded local filesystem I/O; prompts must stay within the model context window for any supported repository size.

**Constraints**: Reuse the Phase 1/2 retrieval contract; do not change `HybridRetrieverService` or the evidence merge/ranking. Code content augments in-memory context only and is never persisted or returned by API responses. Every stage keeps its existing grounding guarantees (citations reference real paths; ungrounded claims are removed or marked unverified). The one-active-document-per-repository invariant already prevents concurrent drafts for the same repository.

**Scale/Scope**: One internal code-loading capability used by the drafting pipeline's three model-facing stages. Re-clone happens at most once per draft job. No HTTP, queue, or authorization surface changes.

## Constitution Check

### Pre-design

- **Ownership**: `ArchitectureDocModule` owns the new `CodeContextLoaderService`, the extended prompt templates, the DTO extensions, and the module wiring. `DraftingOrchestratorService` remains the drafting owner and gains `userId` threading plus a single clone-ensure call. `GitService` (via `GitModule`) owns cloning; `PrismaService` owns repository metadata. The new bounds are configured through a new `drafting` config namespace registered in `ConfigModule`.
- **Executable verification**: Unit tests cover the loader (accessible path reuse, re-clone when missing, per-file read success/failure, per-file and per-context truncation, total budget enforcement) and each stage service (prompts contain code evidence; verifier follow-up is enriched). Existing orchestrator specs are extended for `userId` threading and the null-code-root fallback path.
- **Jobs and workspaces**: The drafting job already reports monotonic `DocStatus` stages and creates no transient workspace. A re-clone writes to a persistent `Repository.localPath` (the same persistent-clone pattern `DocumentationPipeline` uses when reusing an existing path), so no additional workspace-cleanup contract applies.
- **Grounding**: This feature extends the grounding source set for drafting to include the repository's own source code, which is a stricter, factual basis than file descriptions alone. Raw code is never persisted (FR-008), citations still reference real paths, and unreadable code is recorded per file (FR-006). Persistence of sections, citations, verification results, and diagrams is unchanged.
- **Tenant isolation**: The drafting job payload already carries the authorized `userId`; ownership is enforced in `ArchitectureDocService` before enqueueing. Re-cloning reuses `GitService.clone` with that same `userId`. No new authorization surface is added.

### Post-design

PASS. The design reuses existing boundaries (`GitService`, `PrismaService`, the `architecture-doc` stage services), adds one single-responsibility loader inside `ArchitectureDocModule`, keeps code out of persistence and API responses, preserves repository scoping and the one-active-document invariant, and provides executable coverage for loading, bounding, fallback, and prompt enrichment. The grounding-source extension (source code, in addition to Chroma/Neo4j) strengthens, rather than weakens, the constitution's grounded-RAG principle and is explicitly documented.

## Project Structure

### Documentation (this feature)

```text
specs/006-code-grounded-drafting/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── code-context-loader.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── drafting.config.ts            # NEW: code-context bounds (register in config.module.ts)
│   └── config.module.ts              # Register draftingConfig in `load`
├── architecture-doc/
│   ├── architecture-doc.module.ts    # Import GitModule; add CodeContextLoaderService provider
│   ├── code-context-loader.service.ts        # NEW: clone resolution + bounded code enrichment
│   ├── code-context-loader.service.spec.ts   # NEW: unit tests
│   ├── drafting-orchestrator.service.ts      # Thread userId; ensureClone once; pass codeRootPath
│   ├── drafting-orchestrator.service.spec.ts # Extended: userId + fallback paths
│   ├── structure-planner.service.ts          # plan(repositoryId, codeRootPath); enrich context
│   ├── structure-planner.service.spec.ts     # Extended: code evidence in prompt
│   ├── section-generator.service.ts          # generate(..., codeRootPath); enrich context
│   ├── section-generator.service.spec.ts     # Extended: code evidence in prompt
│   ├── section-verifier.service.ts           # verify(..., codeRootPath); enrich + follow-up enrich
│   ├── section-verifier.service.spec.ts      # Extended: code evidence + follow-up enrich
│   ├── dto/
│   │   ├── hybrid-retrieval-context.dto.ts   # RetrievedFile += codeContent?, codeLoadError?
│   │   └── architecture-draft.dto.ts         # DraftRequest += userId
│   └── templates/
│       ├── structure-plan.prompt.ts          # Add code-evidence block
│       ├── section-generation.prompt.ts      # Add code-evidence block
│       └── section-verification.prompt.ts    # Add code-evidence block
```

**Structure Decision**: Keep the new capability inside `architecture-doc`. A single `CodeContextLoaderService` owns both clone resolution and bounded file reading; stage services stay thin by delegating enrichment to it. `GitModule` is imported (it already exports `GitService`). Bounds live in a `drafting` config namespace, mirroring the existing `documentation` config pattern.

## Implementation Approach

1. **Add `drafting` config** in `src/config/drafting.config.ts` with three bounds driven by environment variables (documented in `.env.example`):
   - `codeContextMaxFiles` (`DRAFTING_CODE_CONTEXT_MAX_FILES`, default `12`): max files that receive code snippets in one context.
   - `codeContextMaxCharsPerFile` (`DRAFTING_CODE_CONTEXT_MAX_CHARS_PER_FILE`, default `4000`): per-file snippet cap; files are truncated to this length.
   - `codeContextMaxTotalChars` (`DRAFTING_CODE_CONTEXT_MAX_TOTAL_CHARS`, default `32000`): total code characters allowed in one context; files beyond the budget are dropped from code (descriptions remain).
   Register `draftingConfig` in `config.module.ts` and document the variables in `.env.example`.

2. **Extend the DTOs** in `src/architecture-doc/dto/`:
   - `RetrievedFile` gains optional `codeContent?: string` and `codeLoadError?: string`.
   - `DraftRequest` gains `userId: string` so the orchestrator can re-clone with the authorized user.

3. **Implement `CodeContextLoaderService`** in `src/architecture-doc/code-context-loader.service.ts`:
   - `ensureClone(repositoryId, userId): Promise<string | null>`: read the repository from Prisma; if `localPath` is set and `fs.access` succeeds, return it. Otherwise clone via `GitService.clone` (cloneUrl, defaultBranch, destination `<workspaceRoot>/draft-<repositoryId>`, `--depth 1`) and update `Repository.localPath`. Return the path, or `null` on any failure (logged). Memoize the resolved path per `repositoryId` in an instance `Map`; the one-active-document invariant prevents concurrent drafts for the same repository.
   - `enrich(context, rootPath): Promise<HybridRetrievalContext>`: for files in `context.files` (processed in `combinedScore` order, at most `codeContextMaxFiles`), read `rootPath/<filePath>` with `fs.readFile`; apply `codeContextMaxCharsPerFile` truncation and the cumulative `codeContextMaxTotalChars` budget; set `codeContent` on success or `codeLoadError` on failure (missing path, binary/unreadable, oversized). Files beyond the budget or without code keep their descriptions and no error flag. Return a new context with enriched files.

4. **Thread the code source through the orchestrator** in `drafting-orchestrator.service.ts`: `draft()` now accepts `DraftRequest` (with `userId`). After the readiness check and before broad retrieval, call `ensureClone(repositoryId, request.userId)` once and log whether code is available. Pass `codeRootPath` into `structurePlanner.plan()`, each `sectionGenerator.generate()`, and each `sectionVerifier.verify()`. Keep all existing progress reporting and partial-failure behavior unchanged; a `null` code root still produces a description-only draft (SC-006 fallback).

5. **Enrich contexts in the stage services**:
   - `StructurePlannerService.plan(repositoryId, codeRootPath)`: enrich the broad retrieval context with `codeContextLoader.enrich(context, codeRootPath)` before building the plan prompt.
   - `SectionGeneratorService.generate(repositoryId, plan, context, codeRootPath)`: enrich the (possibly internally retrieved) context before building the generation prompt.
   - `SectionVerifierService.verify(section, context, repositoryId, codeRootPath)`: enrich the context before building the verification prompt, and enrich the follow-up context returned by `attemptFollowUp` before the follow-up verification call.

6. **Extend the three prompt templates** to include a "Source code evidence" block. For each enriched file, render `path`, optional one-line description, and the code snippet inside a fenced block; render `[code unavailable: <codeLoadError>]` when the file has a load error and omit files with neither. Add instructions: every non-trivial claim and citation must be consistent with the provided code; code is authoritative for symbol names, behaviors, and flows; do not invent code not shown.

7. **Wire the module**: import `GitModule` into `ArchitectureDocModule` and add `CodeContextLoaderService` to its providers. No controller, queue, or processor changes are needed; the processor already passes the job payload through `draft({ repositoryId })`, which now carries `userId` from `ArchitectureDocJobPayload`.

8. **Unit tests**:
   - `code-context-loader.service.spec.ts`: reuses an accessible `localPath`; re-clones and updates `localPath` when missing; returns `null` and logs on clone failure; reads file content; truncates per-file; enforces the total budget; sets `codeLoadError` for missing/binary/oversized files; keeps descriptions for files without code.
   - `structure-planner.service.spec.ts`, `section-generator.service.spec.ts`, `section-verifier.service.spec.ts`: assert the built prompts contain code evidence and that the verifier enriches the follow-up context.
   - `drafting-orchestrator.service.spec.ts`: `userId` reaches `ensureClone`; `ensureClone` is called once; a `null` code root still completes drafting with description-only context.

9. **Integration/quickstart**: extend `quickstart.md` with a fixture-repository scenario that indexes a small repo, runs a draft, and verifies sections are consistent with the real code and that code is absent from persisted sections. Existing `architecture-doc.e2e-spec.ts` needs no change because it controls the draft result.

## Complexity Tracking

No constitutional violations or additional abstractions require justification. The grounding-source extension (source code added to Chroma/Neo4j-derived evidence) is an intentional, documented strengthening of the constitution's grounded-RAG principle; it adds no new storage, authorization, or persistence surface.
