# Quickstart: Code-Grounded Drafting

**Feature**: `006-code-grounded-drafting` | **Date**: 2026-08-03

## Prerequisites

- Node.js 20+ and npm installed
- PostgreSQL 18 running with the Nebula database and Prisma migrations applied
- Redis 7 running (BullMQ for the architecture-draft queue)
- ChromaDB and Neo4j reachable, with at least one repository fully indexed (status `READY`, code clone present at its `localPath`)
- `.env` configured (see `.env.example`), including the new optional drafting bounds:
  - `DRAFTING_CODE_CONTEXT_MAX_FILES` (default `12`)
  - `DRAFTING_CODE_CONTEXT_MAX_CHARS_PER_FILE` (default `4000`)
  - `DRAFTING_CODE_CONTEXT_MAX_TOTAL_CHARS` (default `32000`)

## Setup

```bash
npm install
npx prisma generate
```

Verify a READY repository exists:

```bash
npx ts-node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.repository.findMany({ where: { status: 'READY' } })
    .then(repos => console.log('Ready repos:', repos.map(r => ({ id: r.id, name: r.name, localPath: r.localPath }))))
    .finally(() => prisma.\$disconnect());
"
```

## Validation Scenarios

### Scenario 1: Code Loader Bounds and Fallback (SC-004, SC-006)

**Goal**: The loader reads bounded code, truncates per file, enforces the total budget, and records per-file errors without dropping descriptions.

```bash
npx jest --testPathPattern="code-context-loader" --verbose
```

**Expected outcome**:
- Files reuse an accessible `localPath`; a missing clone triggers a re-clone and updates `localPath`
- `codeContent` never exceeds the per-file cap; the total cap is respected
- A forced unreadable file yields `codeLoadError` with its description retained
- A `null` root path returns the context unchanged

### Scenario 2: Code Evidence Reaches the Prompts (FR-001..FR-003)

**Goal**: Structure planning, section generation, and section verification prompts embed the code evidence.

```bash
npx jest --testPathPattern="structure-planner|section-generator|section-verifier" --verbose
```

**Expected outcome**:
- Each built prompt contains a code-evidence block listing loaded `codeContent` and `code unavailable` markers for `codeLoadError` files
- The verifier's follow-up retrieval context is also enriched

### Scenario 3: Orchestrator Threading and Fallback (SC-006)

**Goal**: `userId` reaches the loader, `ensureClone` is called once per draft, and a `null` code root still completes drafting.

```bash
npx jest --testPathPattern="drafting-orchestrator" --verbose
```

**Expected outcome**:
- `ensureClone` receives the authorized `userId` and is invoked exactly once per `draft()`
- With `ensureClone` returning `null`, the draft completes using description-only evidence

### Scenario 4: End-to-End Draft on a Fixture Repository (SC-001, SC-002, SC-005)

**Goal**: A real draft is consistent with the actual code, and persisted documents contain no raw code.

**Prerequisite**: A small fixture repository imported, documented (status `READY`), and drafted via the existing `architecture-doc` endpoints.

**Run**:
```bash
npm run test:e2e -- architecture-doc.e2e-spec.ts
```

Then manually verify a generated document by fetching the latest completed version and checking that:
- Section claims match symbol names and behaviors visible in the repository's source
- Every `sourceFiles` entry exists in the repository and its code was loadable
- `contentMd` sections contain prose and citations only — no raw code dumps

## Run All Validation

```bash
npx jest --testPathPattern="code-context-loader|structure-planner|section-generator|section-verifier|drafting-orchestrator" --verbose
```

## Troubleshooting

| Issue | Resolution |
|---|---|
| Draft continues but sections have no code grounding | Check the draft job logs for "clone" warnings and `codeLoadError` markers; verify `Repository.localPath` exists on the server host (not just locally). |
| Re-clone fails on private repos | Ensure the linked GitHub account token has `repo` scope; see `GitService.clone` behavior. |
| Prompts too large on big repositories | Lower `DRAFTING_CODE_CONTEXT_MAX_FILES` or `DRAFTING_CODE_CONTEXT_MAX_CHARS_PER_FILE`. |
