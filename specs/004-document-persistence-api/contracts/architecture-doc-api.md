# Architecture Document API Contract

All routes require the existing JWT guard and use the repository owner's identity. Responses use the established envelope:

```json
{ "success": true, "message": "...", "data": {} }
```

## Trigger a document

`POST /repositories/:repositoryId/architecture-doc`

Request body (optional):

```json
{ "commitSha": "currently-indexed-commit" }
```

Successful acceptance returns HTTP 202:

```json
{
  "docId": "document-uuid",
  "jobId": "document-uuid",
  "version": 3,
  "status": "PENDING"
}
```

If a document is already active, return HTTP 202 with that document's same shape; do not create another version. Reject missing/non-owned repositories, non-ready repositories, and commit values that differ from the current indexed commit.

## Poll a document job

`GET /repositories/:repositoryId/architecture-doc/jobs/:jobId`

Returns HTTP 200 for the owned matching document:

```json
{
  "jobId": "document-uuid",
  "docId": "document-uuid",
  "status": "GENERATING",
  "errorMessage": null
}
```

The job must belong to the route repository. Terminal failures return `FAILED` and the persisted error message.

## Fetch the latest completed document

`GET /repositories/:repositoryId/architecture-doc`

Returns the latest `COMPLETED` version only. A document response has:

```json
{
  "docId": "document-uuid",
  "version": 3,
  "status": "COMPLETED",
  "commitSha": "currently-indexed-commit",
  "generatedAt": "2026-07-26T10:00:00.000Z",
  "verificationScore": 0.94,
  "sections": [
    {
      "key": "overview",
      "title": "System Overview",
      "order": 0,
      "contentMd": "...",
      "sourceFiles": ["src/main.ts"],
      "diagramMermaid": "flowchart TD ...",
      "verified": true,
      "verificationNotes": null
    }
  ]
}
```

## List and fetch history

`GET /repositories/:repositoryId/architecture-doc/versions`

Returns all owned document versions with `docId`, `version`, `status`, `generatedAt`, and `verificationScore`, newest first.

`GET /repositories/:repositoryId/architecture-doc/versions/:version`

Returns that owned version in the document-response shape. A non-completed version has no published sections and exposes its lifecycle/error metadata only.

## Regenerate

`POST /repositories/:repositoryId/architecture-doc/regenerate`

Uses the same optional request body and acceptance response as the trigger endpoint. If no work is active, it creates the next version; it never changes an earlier version.
