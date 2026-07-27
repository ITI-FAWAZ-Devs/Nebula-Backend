# Quickstart: Validate Hybrid Repository Retrieval

## Prerequisites

- Node.js and the project dependencies installed.
- A PostgreSQL database configured by `DATABASE_URL`.
- Reachable Chroma and Neo4j instances plus valid Gemini credentials, configured from `.env`.
- A small fixture repository that has completed both existing indexing flows: documentation indexing (semantic descriptions) and analysis (repository graph).

## Apply the Data Model

```powershell
npm install
npx prisma db push
npx prisma generate
```

Or, to use migrations instead of direct push:

```powershell
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > migration.sql
# Inspect migration.sql then apply to the database
```

Expected result: the database schema exposes `GeneratedDoc`, `DocSection`, and `DocStatus`.

## Run Focused Checks

```powershell
npm test -- hybrid-retriever.service.spec.ts neo4j.service.spec.ts
$env:RUN_GENERATED_DOCS_INTEGRATION="true"; npm run test:e2e -- generated-docs.e2e-spec.ts
$env:RUN_HYBRID_RETRIEVAL_INTEGRATION="true"; npm run test:e2e -- hybrid-retrieval.e2e-spec.ts
npm run build
```

Expected result:

1. Unit checks (24 tests) show that a direct graph neighbor is retained, duplicate paths/edges are removed, both-signal files are boosted, invalid queries fail before source calls, and partial-source status is explicit.
2. The database checks (5 tests) create a document with ordered sections, reject a duplicate document version and duplicate section key, cascade deletions, and retain earlier versions.
3. The integration check uses the configured stores and fixture repository to retrieve a known topic. It returns the semantic seed and at least one directly related file that was not independently in the semantic top results.
4. The build completes with the generated Prisma client and no TypeScript errors.

## Manual Smoke Check

From a Nest testing module configured with the fixture repository, call the internal retrieval operation with a known topic and inspect the returned context:

- `files` contains only paths from the fixture repository.
- `relationships` contains at least one direct edge from a semantic seed.
- `sourceStatus` is `available` for both stores.
- `noEvidence` is false.

The feature has no HTTP route in Phase 1; invoking the internal service is the intended validation surface.
