# Data Model: Persist Architecture Documents

## Existing entities reused

### GeneratedDoc

One durable architecture-document version for a repository. Its UUID is also the BullMQ custom job ID.

| Field | Purpose | Rules |
|---|---|---|
| `id` | Document and job identifier | Immutable UUID; supplied as the queue job ID. |
| `repositoryId` | Owning repository | Must belong to the authenticated user for all reads/triggers. |
| `version` | Repository-scoped version | Next `max(version) + 1`; unique with `repositoryId`. |
| `status` | Generation lifecycle | `PENDING → RETRIEVING → GENERATING → VERIFYING → COMPLETED`, or `FAILED` from a non-terminal state. |
| `commitSha` | Evidence revision | Omitted or equals `Repository.lastIndexedCommit`. |
| `triggeredByUserId` | Requesting user | Set when a document is accepted. |
| `model` | Draft model identity | Copied from the configured drafting model. |
| `verificationScore` | Publishable-section confidence | `verified / persisted sections`; null when no sections persist. |
| `errorMessage` | Terminal failure detail | Null on success; set when processing or queueing fails. |
| `generatedAt` | Completion time | Set only after sections persist successfully. |

### DocSection

One publishable section belonging to a generated-document version.

| Field | Purpose | Rules |
|---|---|---|
| `docId` | Parent document | Cascades on document deletion. |
| `key` | Repository-specific section identity | Unique within a document. |
| `title`, `order`, `contentMd` | Rendered document content | Copied from a non-removed draft section; returned in ascending order. |
| `sourceFiles` | Grounding citations | Copied unchanged from the draft. |
| `diagramMermaid` | Optional architecture diagram | Stored with the selected document version. |
| `verified`, `verificationNotes` | Verification outcome | Derived directly from the section or diagram verdict/notes. |

## Relationships

```text
Repository 1 ── * GeneratedDoc 1 ── * DocSection
                    │
                    └── BullMQ job (same identifier; not a database relation)
```

## Lifecycle rules

1. A request first verifies ownership, readiness, and the requested commit.
2. It returns an existing active document if one exists; otherwise it creates the next pending version.
3. The worker advances the new version through visible drafting statuses.
4. Completion persists all publishable sections and document metadata atomically.
5. Any queueing, drafting, or persistence error leaves the version terminally `FAILED` with an error message; an earlier completed version remains the latest readable document.
