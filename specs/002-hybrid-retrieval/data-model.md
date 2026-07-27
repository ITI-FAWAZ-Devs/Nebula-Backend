# Data Model: Hybrid Repository Retrieval

## Internal Retrieval Types

### `HybridRetrievalQuery`

| Field | Required | Rules |
|---|---:|---|
| `topic` | No | Trimmed free-text topic. At least one of `topic` or `filePaths` is required. |
| `filePaths` | No | Non-empty, repository-relative paths. Missing indexed paths are reported, not fabricated. |

### `HybridRetrievalOptions`

| Field | Default | Rules |
|---|---:|---|
| `semanticLimit` | 10 | Integer from 1 through 20. |
| `maxHops` | 1 | Integer 1 or 2. |
| `maxFiles` | 25 | Integer from 1 through 25. |

### `HybridRetrievalContext`

| Field | Description |
|---|---|
| `repositoryId` | Repository scope applied to every source read. |
| `files` | Unique ranked file evidence. Each entry has `filePath`, optional description, optional raw semantic distance, semantic rank, graph hop(s), evidence source(s), and combined ranking score. |
| `relationships` | Unique file-resolved edges with `fromFilePath`, `toFilePath`, relationship type, hop distance, and graph edge identifier. |
| `moduleClusters` | Optional cluster memberships returned only when the graph contains them. |
| `missingSeedPaths` | Requested paths that did not resolve in the indexed repository. |
| `sourceStatus` | Independent semantic and graph statuses: `available`, `empty`, or `unavailable`. |
| `noEvidence` | True only when both sources completed successfully and yielded no grounded evidence. |

## Persistent Entities

### `GeneratedDoc`

| Field | Type | Rules |
|---|---|---|
| `id` | String | Primary identifier. |
| `repositoryId` | String | Required relation to `Repository`; cascade on repository deletion. |
| `version` | Integer | Required; unique with `repositoryId`. |
| `status` | `DocStatus` | Defaults to `PENDING`. |
| `commitSha` | String? | Optional indexed source revision. |
| `triggeredByUserId` | String? | Optional initiating-user identifier. |
| `model` | String | Required generation-model identifier. |
| `verificationScore` | Float? | Optional aggregate verification fraction from 0 to 1. |
| `errorMessage` | Text? | Optional inspectable failure detail. |
| `generatedAt` | DateTime? | Set when generation completes. |
| `createdAt` / `updatedAt` | DateTime | Creation timestamp and automatic update timestamp. |

Indexes and constraints:

- Unique: `(repositoryId, version)`.
- Index: `(repositoryId, status)`.
- Relation: one `Repository` has many `GeneratedDoc` records.

### `DocSection`

| Field | Type | Rules |
|---|---|---|
| `id` | String | Primary identifier. |
| `docId` | String | Required relation to `GeneratedDoc`; cascade on document deletion. |
| `key` | String | Required, unique within one document. |
| `title` | String | Required section title. |
| `order` | Integer | Required presentation order. |
| `contentMd` | Text | Required markdown content. |
| `sourceFiles` | String array | Required cited repository paths. |
| `diagramMermaid` | Text? | Optional diagram content, normally on one overview section. |
| `verified` | Boolean | Defaults to false. |
| `verificationNotes` | Text? | Optional verification rationale. |
| `createdAt` | DateTime | Creation timestamp. |

Indexes and constraints:

- Unique: `(docId, key)`.
- Index: `(docId, order)`.

### `DocStatus`

```text
PENDING → RETRIEVING → GENERATING → VERIFYING → COMPLETED
                                      └──────────────→ FAILED
```

Phase 1 defines and persists the states. Their transitions are performed by the Phase 3 background workflow.

## Validation and Deletion Rules

- A retrieval request must include at least one non-empty topic or seed path.
- `maxHops` must be 1 or 2; limits must remain within the configured contract bounds.
- File paths are canonicalized before de-duplication; duplicate paths and edges are not returned.
- Duplicate document versions within a repository and duplicate section keys within a document are rejected by database constraints.
- Deleting a repository cascades to generated documents; deleting a document cascades to its sections.
