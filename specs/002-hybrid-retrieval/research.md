# Research: Hybrid Repository Retrieval

## Decision: Reuse the existing semantic and embedding services

**Decision**: `HybridRetrieverService` will call `GeminiService.embedString()` only for a non-empty topic, then call `ChromaService.queryCollection()` against `repo-{repositoryId}`. Explicit seed paths bypass semantic lookup and are still graph-expanded.

**Rationale**: `AskService` already proves this repository-scoped collection and embedding flow. Reusing it keeps one embedding configuration and avoids a second vector client.

**Alternatives considered**:

- Add a new vector client: rejected; it duplicates configuration and bypasses the existing storage boundary.
- Query by text directly in Chroma: rejected; the installed client flow already stores and queries precomputed embeddings.

## Decision: Add a narrow typed graph-read method to `Neo4jService`

**Decision**: Add a parameterized read method that accepts `repositoryId`, canonical seed paths, and a hop limit of 1 or 2. It returns file-resolvable graph nodes and relationships only; the feature service never opens Neo4j sessions or writes Cypher.

**Rationale**: The current `Neo4jService` can save graphs but has no read API. A single service method preserves the existing data-store boundary and enforces the repository predicate in one place.

**Alternatives considered**:

- Query Neo4j in `HybridRetrieverService`: rejected; it leaks the raw client and repository filter into a second service.
- Add a generic graph repository layer: rejected; one read operation does not warrant a new abstraction.

## Decision: Rank by ordered semantic evidence, then apply bounded graph evidence

**Decision**: Preserve Chroma's returned distance as `semanticDistance` and derive a metric-independent semantic rank score from result order. Add a fixed boost for graph evidence, with direct neighbors weighted above second-hop neighbors; both-signal files therefore rank above otherwise comparable single-signal files. Sort deterministically by combined score then canonical file path.

**Rationale**: The current Chroma wrapper exposes distances but does not establish whether a larger or smaller value is more similar. Rank order is reliable, avoids an invalid metric conversion, and is easy to test.

**Alternatives considered**:

- Convert distance to similarity with a fixed formula: rejected; it assumes a distance metric the wrapper does not declare.
- Give all graph neighbors equal priority: rejected; it weakens the direct-neighbor acceptance criterion and can over-rank distant files.

## Decision: Use conservative retrieval defaults

**Decision**: Default to 10 semantic candidates, 1 graph hop, and 25 returned files. Permit 2 hops only through an explicit option; validate all bounds before querying.

**Rationale**: A one-hop default proves graph fusion while keeping context relevant and within the 3-second target. Two hops remains available for architecture sections requiring wider context.

**Alternatives considered**:

- Always use two hops: rejected; graph fan-out can swamp semantic relevance.
- Make limits unbounded: rejected; it risks latency and excessive drafting context.

## Decision: Do not change the existing indexing pipeline for clusters

**Decision**: Include optional module-cluster data in the context, but return an empty cluster set until indexed graph data actually contains clusters. Do not remove the current Graphify `--no-cluster` option in this phase.

**Rationale**: The feature specification requires cluster membership only when available. The current indexing pipeline explicitly disables cluster extraction, and changing it would expand Phase 1 beyond a retrieval/data-model foundation.

**Alternatives considered**:

- Enable cluster extraction now: rejected; it changes upstream indexing behavior and needs separate acceptance coverage.
- Invent clusters from directory names: rejected; this would fabricate structural evidence.

## Decision: Model versioned documents with two tables and one enum

**Decision**: Add `GeneratedDoc`, `DocSection`, and `DocStatus` exactly as described in the source plan, with unique `(repositoryId, version)` and `(docId, key)` constraints, ordered-section indexing, and cascade deletion from repository to document to section.

**Rationale**: The relational model stores document history without an archive table and keeps source-file citations queryable as a PostgreSQL string array.

**Alternatives considered**:

- Store an entire document as JSON: rejected; it weakens ordered-section and source-reference querying.
- Add a separate version/archive table: rejected; the document version is already a first-class column.
