# Quickstart: Grounded Architecture Drafting

**Feature**: `003-architecture-drafting` | **Date**: 2026-07-26

## Prerequisites

- Node.js 20+ and npm installed
- PostgreSQL 18 running with the Nebula database and Prisma migrations applied
- ChromaDB instance running and accessible (cloud or local)
- Neo4j instance running and accessible
- `.env` configured with valid `GEMINI_API_KEY`, Chroma credentials, Neo4j credentials, and `DATABASE_URL`
- At least one repository fully indexed (status `READY`) with evidence in both Chroma (`repo-{repositoryId}` collection) and Neo4j

## Setup

```bash
# Install dependencies
npm install

# Ensure Prisma client is generated
npx prisma generate

# Verify the database has a READY repository
npx ts-node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.repository.findMany({ where: { status: 'READY' } })
    .then(repos => { console.log('Ready repos:', repos.map(r => ({ id: r.id, name: r.name }))); })
    .finally(() => prisma.\$disconnect());
"
```

## Validation Scenarios

### Scenario 1: Full Pipeline — Grounded Draft with Citations (SC-001, SC-005)

**Goal**: Verify that the drafting pipeline produces sections with cited file paths that exist in the repository evidence.

```bash
# Run the unit test suite for the drafting pipeline
npx jest --testPathPattern="architecture-doc" --verbose
```

**Expected outcome**:
- All drafting orchestrator tests pass
- Every `DraftSection` with `verdict: 'verified'` contains at least one entry in `sourceFiles`
- Every entry in `sourceFiles` matches a file path present in the mocked retrieval evidence

### Scenario 2: Repository-Specific Structure (SC-002)

**Goal**: Verify that two repositories with different evidence produce different section plans.

```bash
# Run the structure planner tests
npx jest --testPathPattern="structure-planner" --verbose
```

**Expected outcome**:
- When the structure planner receives evidence for two repositories with materially different file structures and concerns, the resulting `SectionPlan[]` arrays have different key sets

### Scenario 3: Seeded Hallucination Detection (SC-003)

**Goal**: Verify that the verifier catches a deliberately unsupported section.

```bash
# Run the section verifier tests — the hallucination fixture
npx jest --testPathPattern="section-verifier" --verbose
```

**Expected outcome**:
- A section generated from unrelated or empty context is returned with `verdict: 'unverified'` and non-null `verificationNotes`, OR the unsupported claim is removed from `contentMd`
- The test explicitly asserts that unsupported content is not passed through as `verdict: 'verified'`

### Scenario 4: Diagram Validation (SC-004)

**Goal**: Verify that the diagram contains only evidenced modules and uses valid Mermaid syntax.

```bash
# Run the diagram generator tests
npx jest --testPathPattern="diagram-generator" --verbose
```

**Expected outcome**:
- The generated `mermaidSource` starts with `flowchart` or `graph`
- Every module name in the diagram exists in the `moduleClusters` or `relationships` evidence
- When no relationship evidence is provided, the diagram is `null` with a verification note

### Scenario 5: Tenant Isolation (SC-006)

**Goal**: Verify that all retrieval calls are scoped to the requested `repositoryId`.

```bash
# Run the orchestrator tests that check repositoryId propagation
npx jest --testPathPattern="drafting-orchestrator" --verbose
```

**Expected outcome**:
- Every call to `HybridRetrieverService.retrieve` receives the same `repositoryId` passed to `DraftingOrchestratorService.draft`
- No cross-repository data appears in the result

### Scenario 6: Integration Test — Live Stores

**Goal**: Run the full pipeline against a small fixture repository seeded in live Chroma and Neo4j stores.

```bash
# Seed the fixture data and run the integration test
npx jest --config jest-e2e.config.ts --testPathPattern="drafting-pipeline.e2e" --verbose
```

**Expected outcome**:
- The drafting pipeline returns an `ArchitectureDraft` with at least one section
- Every section's `sourceFiles` contains paths that exist in the fixture repository's Chroma collection
- The seeded-hallucination fixture section is caught (verdict ≠ `verified` or claim removed)
- If diagram evidence is present, the diagram validates against the fixture's Neo4j relationships

## Run All Validation

```bash
# Unit tests
npx jest --testPathPattern="architecture-doc" --verbose --coverage

# Integration tests (requires live stores)
npx jest --config jest-e2e.config.ts --testPathPattern="drafting-pipeline" --verbose
```

## Troubleshooting

| Issue | Resolution |
|---|---|
| "Repository not found" error | Ensure a repository with status `READY` exists in the database. Run the documentation pipeline first. |
| Empty sections / no plan | Check that the Chroma collection `repo-{repositoryId}` has documents. Verify Neo4j has nodes with the matching `repositoryId`. |
| LLM timeout / rate limit | Check `GEMINI_API_KEY` validity. Consider increasing the delay between LLM calls or reducing the number of sections. |
| "Both sources unavailable" | Verify Chroma and Neo4j connectivity in `.env`. Check that the services are running. |
