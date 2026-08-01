# Hybrid Retrieval Fixture Repository

Three source files for deterministic unit and integration tests:

| File | Role |
|------|------|
| `src/auth/login.ts` | Semantic seed — indexed in Chroma and Neo4j |
| `src/auth/session.ts` | Direct graph neighbor of `login.ts` via `IMPORTS` edge (low semantic similarity) |
| `src/config/settings.ts` | Unrelated file — not reachable from the seed in one hop |
