# Internal Contract: Hybrid Retrieval

## Consumer

The contract is internal to the backend. Phase 2's drafting service is its first consumer. This phase exposes no HTTP endpoint.

## Service Operation

```text
retrieve(repositoryId, query, options?) -> Promise<HybridRetrievalContext>
```

| Input | Contract |
|---|---|
| `repositoryId` | Required existing repository identifier. Used to scope every semantic and graph read. |
| `query.topic` | Optional non-empty free text. When present, it produces semantic candidates. |
| `query.filePaths` | Optional non-empty seed paths. When present, they are graph-expanded even without a topic. |
| `options.semanticLimit` | Optional 1–20; default 10. |
| `options.maxHops` | Optional 1 or 2; default 1. |
| `options.maxFiles` | Optional 1–25; default 25. |

At least one of `query.topic` or `query.filePaths` is required.

## Result Guarantees

- Every returned file is unique by canonical repository-relative path.
- Every returned relationship is unique by graph edge identifier and canonical endpoints.
- Each file preserves raw semantic distance when semantic evidence exists and records whether it has semantic, graph, or both evidence.
- A direct graph neighbor is retained even when it has no semantic result.
- Ranking is deterministic: combined score descending, then canonical file path ascending.
- `moduleClusters` contains only graph-supplied memberships. An empty list means no such data is available; it is never inferred.

## Availability and Failure Semantics

| Condition | Result |
|---|---|
| Both sources available but no matches | Resolve a valid context with `noEvidence: true`. |
| One source unavailable, the other returns evidence | Resolve a context with available evidence and source status showing the unavailable source. |
| One source unavailable, the other is empty | Resolve a context with `noEvidence: false`; the caller can distinguish unavailable from no evidence. |
| Both sources unavailable | Fail explicitly; do not return a no-evidence context. |
| Repository absent | Fail as not found. |
| Topic and seed paths both absent | Fail validation before querying either store. |

## Privacy Boundary

The service does not accept a user identity because it is an internal dependency. It enforces repository identifiers in both source reads. Any future controller or job must verify repository ownership before invoking the service.
