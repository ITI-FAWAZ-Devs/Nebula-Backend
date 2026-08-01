# Quickstart: Validate Architecture Document Persistence

## Prerequisites

- PostgreSQL and Redis configured through the project's environment variables.
- An authenticated test user that owns a repository in `READY` state with `lastIndexedCommit` populated.
- A deterministic or mocked drafting result for automated endpoint tests; live drafting also requires the existing Chroma, Neo4j, and Gemini dependencies.

## Automated checks

Run focused unit coverage while implementing:

```powershell
npm test -- architecture-doc
```

Run the endpoint flow suite after the controller and processor are wired:

```powershell
npm run test:e2e -- architecture-doc.e2e-spec.ts
```

Run the existing persistence integration suite against an explicitly enabled test database:

```powershell
$env:RUN_GENERATED_DOCS_INTEGRATION = 'true'
npm run test:e2e -- generated-docs.e2e-spec.ts
```

## Manual acceptance flow

1. Start a document request for a ready repository, omitting `commitSha` or using its indexed commit. Confirm HTTP 202 returns equal `docId` and `jobId` values.
2. Repeat the request before completion. Confirm the same identifiers and version return.
3. Poll the job until it reaches `COMPLETED`; observe the applicable retrieval, generation, and verification statuses.
4. Fetch the latest document. Confirm sections are ordered, retain citations and verification information, and return any diagram.
5. Request regeneration after completion. Confirm a new version is created, the first version remains readable, and the latest endpoint serves the newer completed version.
6. Force drafting to fail. Confirm the affected version is `FAILED` with an error, while an earlier completed version remains readable.
7. Repeat trigger, poll, fetch, history, and version requests as a non-owner. Confirm each is denied.

See [data-model.md](data-model.md) for lifecycle details and [architecture-doc-api.md](contracts/architecture-doc-api.md) for request/response shapes.
