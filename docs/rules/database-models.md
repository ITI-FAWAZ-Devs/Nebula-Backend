---
description: PostgreSQL models (Prisma) and Neo4j graph schema reference
globs: prisma/**,src/prisma/**,src/neo4j/**,src/repositories/**,src/users/**
alwaysApply: false
---

# Database Models

## PostgreSQL (Prisma)

### Enums
```
AuthProvider      = LOCAL | GITHUB | GOOGLE | GITLAB | MICROSOFT
RepositoryStatus  = IMPORTED | CLONING | INDEXING | READY | FAILED
AnalysisJobStatus = QUEUED | RUNNING | COMPLETED | FAILED
```

### Relationships
```
User  1──* Account
User  1──* VerificationToken
User  1──* PasswordResetToken
User  1──* Repository
Repository 1──* AnalysisJob
```

### Models
**User** (`users`): `id`, `email` (unique), `password?`, `fullName?`, `avatar?`, `isEmailVerified`, `refreshToken?` (argon2 hash)

**Account** (`accounts`): `userId`, `provider`, `providerId`, `accessToken?` (encrypted), `refreshToken?` (encrypted) — unique on `(provider, providerId)` and `(userId, provider)`; cascade-delete with user

**VerificationToken**: `userId`, `token`, `expiresAt`

**PasswordResetToken**: `userId`, `token`, `expiresAt`, `used`

**Repository** (`repositories`): `userId`, `githubRepoId`, `name`, `fullName`, `private`, `cloneUrl`, `localPath?`, `status` (RepositoryStatus), `lastIndexedCommit?` — unique on `(userId, githubRepoId)`

**AnalysisJob** (`analysis_jobs`): `repositoryId`, `status` (AnalysisJobStatus), `stage?`, `error?`, `queueJobId?`, `startedAt?`, `finishedAt?`

### Rules
- Never create `new PrismaClient()` — always inject `PrismaService`
- When adding a model: add to `prisma/schema.prisma`, run `npx prisma migrate dev`, update types where needed
- Use `include` for relations instead of separate queries where possible

---

## Neo4j (Knowledge Graph)

Separate from Postgres. Stores code structure extracted by Graphify.

### Node Labels
`Repository | Directory | File | Class | Interface | Method | Function`

### Relationship Types
`CONTAINS | IMPORTS | CALLS | EXTENDS | IMPLEMENTS | DEPENDS_ON | HAS_METHOD`

### Key Properties
- Every node has `repositoryId` — used to scope and replace graphs per repo
- `Neo4jService.saveGraph()` deletes all existing nodes for a `repositoryId` before inserting — always atomic

### Rules
- Add new node labels in `GraphNormalizerService` mapping
- Add new relationship types in `GraphNormalizerService` + update Cypher in `Neo4jService`
- Never query Neo4j directly outside `Neo4jService`
