# Internal Contract: Code Context Loader

## Consumer

The contract is internal to the backend. `DraftingOrchestratorService`, `StructurePlannerService`, `SectionGeneratorService`, and `SectionVerifierService` are its consumers. It exposes no HTTP endpoint and no persistence writes beyond updating `Repository.localPath` after a re-clone.

## Service Operations

### 1. Ensure Clone

```text
ensureClone(repositoryId, userId) -> Promise<string | null>
```

| Input | Contract |
|---|---|
| `repositoryId` | Existing repository identifier. The repository must be READY (already enforced by callers). |
| `userId` | Authorized repository owner. Used only to re-clone from the stored `cloneUrl` via `GitService`. |

| Result | Contract |
|---|---|
| `string` | Absolute path to an accessible clone. Either the existing `Repository.localPath` (when it passes an accessibility check) or a fresh clone written to `<workspaceRoot>/draft-<repositoryId>` and stored back to `Repository.localPath`. |
| `null` | The clone could not be resolved or re-cloned; the failure is logged. Callers proceed with description-only evidence. |

- The resolved path is memoized per `repositoryId` for the process lifetime. The one-active-document invariant guarantees at most one concurrent draft per repository, so this is safe.
- Re-cloning uses `GitService.clone` with the repository's `cloneUrl`, `defaultBranch`, and the provided `userId`, shallow (`--depth 1`).

### 2. Enrich Context

```text
enrich(context: HybridRetrievalContext, rootPath: string | null) -> Promise<HybridRetrievalContext>
```

| Input | Contract |
|---|---|
| `context` | A retrieval context whose `files` may or may not already carry code evidence. |
| `rootPath` | Resolved clone path from `ensureClone`, or `null` when no clone is available. |

| Result | Contract |
|---|---|
| `HybridRetrievalContext` | A context with enriched `files`. When `rootPath` is `null`, the context is returned unchanged. |

Enrichment rules, applied to files in `combinedScore` order:

- At most `codeContextMaxFiles` files receive `codeContent`.
- Each `codeContent` is truncated to `codeContextMaxCharsPerFile`.
- The cumulative `codeContent` length is bounded by `codeContextMaxTotalChars`; once exhausted, remaining files contribute descriptions only.
- A file whose content cannot be read (missing path, binary, non-UTF-8, oversized) gets `codeContent` omitted and `codeLoadError` set; the description remains.
- `codeContent` and `codeLoadError` are mutually exclusive.

## Result Guarantees

- A file with `codeContent` has a truthful, truncated snapshot of the file at `rootPath` at read time.
- Every file in the enriched context retains its `filePath` and (when present) `description`; enrichment never drops or reorders files.
- Enrichment never alters `relationships`, `moduleClusters`, `missingSeedPaths`, `sourceStatus`, or `noEvidence`.
- Files with neither `codeContent` nor `codeLoadError` remain valid description-only evidence.

## Failure Semantics

| Condition | Result |
|---|---|
| Repository not found | Propagate the caller's not-found behavior; `ensureClone` re-reads the repository and fails cleanly (returns `null`). |
| Existing `localPath` accessible | Reuse it; no clone work. |
| Existing `localPath` missing/inaccessible | Re-clone; on success return the new path. |
| Re-clone fails (auth, network, invalid URL) | Log the error, return `null`. The draft continues with description-only evidence. |
| File read fails (missing, binary, oversized, unreadable) | Set `codeLoadError` on that file; continue with its description. |
| Budget exhausted | Stop adding code; keep descriptions for the remaining files; no error flags. |

## Privacy Boundary

The service is an internal dependency of drafting. It never accepts a raw user identity beyond the authorized `userId` used for re-cloning, and it only reads files from the single repository's own clone. Repository ownership is enforced by `ArchitectureDocService` before the drafting job is enqueued.
