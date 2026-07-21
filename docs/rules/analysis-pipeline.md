---
description: Analysis pipeline stages, types, and rules for the async code-graph generation feature
globs: src/analysis/**,src/graph/**,src/graphify/**,src/git/**,src/discovery/**,src/neo4j/**,src/workspace/**
alwaysApply: false
---

# Analysis Pipeline

Triggered by `POST /api/repositories/:id/analyze`. Runs in a BullMQ worker (`AnalysisProcessor`).
Orchestrated by `AnalysisPipeline`. Updates `AnalysisJob.stage` at every step.

## Stages (in order)
| Stage string | Service | What it does |
|---|---|---|
| `"workspace"` | `WorkspaceService` | Create `workspace/analysis-{jobId}/` |
| `"clone"` | `GitService` | Shallow clone with GitHub OAuth token |
| `"discovery"` | `DiscoveryService` | Detect framework/language/package manager |
| `"graphify"` | `GraphifyService` | Run Graphify CLI → `graph.json` |
| `"normalize"` | `GraphNormalizerService` | Map raw output → `Entity[]` + `Relationship[]` |
| `"build_graph"` | `GraphBuilderService` | Attach `repositoryId`, ensure root Repository node |
| `"save_neo4j"` | `Neo4jService` | Delete old graph + insert new in one transaction |
| `"done"` | — | `AnalysisJob.status = COMPLETED`, `Repository.status = READY` |

On failure: `AnalysisJob.status = FAILED`, `Repository.status = FAILED`, `stage` records where it failed.
Workspace is **always** cleaned in a `finally` block regardless of success/failure.

## Job Payload
```typescript
interface AnalysisJobPayload {
  repositoryId: string;
  analysisJobId: string;
  userId: string;
}
```

## Key Graph Types
```typescript
interface NormalizedGraph   { entities: Entity[];      relationships: Relationship[]; }
interface KnowledgeGraph    { repositoryNode: RepositoryNode; entities: Entity[]; relationships: Relationship[]; }
```

Node types: `repository | directory | file | class | interface | method | function`
Relationship types: `CONTAINS | IMPORTS | CALLS | EXTENDS | IMPLEMENTS | DEPENDS_ON | HAS_METHOD`

## Adding a New Pipeline Stage
1. Create a new service in the relevant module
2. Inject into `AnalysisPipeline`
3. Call `updateJobStage(job, 'your_stage_name')` before invoking the service
4. Handle errors with the existing try/catch/finally pattern

## Neo4j Graph Persistence
Every node/relationship carries `repositoryId`. `Neo4jService.saveGraph()` deletes **all** prior nodes for that `repositoryId` before inserting the new graph — the replace is atomic in a single transaction.
