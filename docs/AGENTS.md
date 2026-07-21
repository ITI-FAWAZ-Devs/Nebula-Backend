# Nebula Backend — AI Context Document (AGENTS.md)

This file is the authoritative source of context for any AI assistant working on this codebase.
Read this before making any changes.

---

## 1. Project Identity

- **Product name:** Nebula
- **Repo folder:** `Mizan-Backend`
- **Purpose:** REST API that lets users authenticate, import their GitHub repositories, and trigger an asynchronous code-analysis pipeline that builds a knowledge graph of the codebase stored in Neo4j.
- **Entry point:** `src/main.ts` → `AppModule` → Express on `PORT` (default `4000`), global prefix `/api` (OAuth callback routes excluded).

---

## 2. Technology Stack

| Concern | Technology |
|---|---|
| Language | TypeScript 5.7 |
| Framework | NestJS 11 (Express adapter) |
| Relational DB | PostgreSQL via Prisma 7 (`@prisma/adapter-pg` + `pg` Pool) |
| Graph DB | Neo4j (`neo4j-driver`) |
| Queue | BullMQ + Redis (`@nestjs/bullmq`, `ioredis`) |
| Auth | Passport (JWT, GitHub OAuth, Google OAuth) + Argon2 password hashing |
| Validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| Mail | Nodemailer + Handlebars templates |
| Git cloning | `simple-git` |
| Graph extraction | Graphify CLI (external binary, called via `execa`) |
| Rate limiting | `@nestjs/throttler` |
| Local infra | Docker Compose — Postgres 18 + Redis 7 |

---

## 3. Repository Structure

```
Mizan-Backend/
├── prisma/
│   └── schema.prisma            # All PostgreSQL models
├── prisma.config.ts             # Prisma 7 driver config
├── src/
│   ├── main.ts                  # Bootstrap: pipes, cors, cookies, prefix
│   ├── app.module.ts            # Root module composition
│   ├── app.controller.ts        # GET /api/ → health check
│   ├── analysis/                # BullMQ queue + worker + pipeline orchestration
│   ├── auth/                    # JWT/OAuth auth, controllers, strategies, guards
│   ├── common/                  # Shared decorators, filters, interceptors, encryption
│   ├── config/                  # Typed env namespaces (registerAs)
│   ├── discovery/               # Framework/language detection from cloned repo
│   ├── git/                     # Authenticated shallow git clone
│   ├── graph/                   # Graphify output normalization → typed graph
│   ├── graphify/                # Graphify CLI runner
│   ├── mail/                    # SMTP + Handlebars templates
│   ├── neo4j/                   # Neo4j driver lifecycle + graph persistence
│   ├── prisma/                  # Global PrismaService
│   ├── repositories/            # GitHub repo listing, import, CRUD
│   ├── users/                   # User/account/token DB operations
│   └── workspace/               # Ephemeral analysis directory management
├── test/                        # e2e Jest config + spec
├── workspace/                   # Runtime clone dirs (gitignored)
├── docker-compose.yaml
├── .env.example
├── Nebula-API.postman_collection.json   # Best source of truth for endpoints
└── nest-cli.json
```

---

## 4. Module Dependency Map

```
AppModule
 ├── ConfigModule (global)
 ├── PrismaModule (global, @Global)
 ├── BullModule.forRoot  (Redis)
 ├── ThrottlerModule
 ├── AuthModule ─────────► UsersModule, MailModule, PassportModule, JwtModule
 ├── UsersModule ─────────► EncryptionService, PrismaService
 ├── MailModule
 └── RepositoriesModule ──► UsersModule, AnalysisModule
       ├── RepositoriesService → PrismaService
       └── GithubClientService → UsersService (to get GitHub token)
             └── AnalysisModule
                   ├── AnalysisService  → PrismaService + Bull queue
                   ├── AnalysisProcessor (BullMQ worker) → AnalysisPipeline
                   └── AnalysisPipeline →
                         WorkspaceService, GitService, DiscoveryService,
                         GraphifyService, GraphNormalizerService,
                         GraphBuilderService, Neo4jService
```

**Global guards registered in `AppModule`:**
1. `JwtAuthGuard` — protects all routes unless decorated with `@Public()`
2. `ThrottlerGuard` — 30 req / 60 s by default; overridden per-route with `@Throttle`

---

## 5. PostgreSQL Data Models (Prisma)

### Enums
```
AuthProvider  = LOCAL | GITHUB | GOOGLE | GITLAB | MICROSOFT
RepositoryStatus = IMPORTED | CLONING | INDEXING | READY | FAILED
AnalysisJobStatus = QUEUED | RUNNING | COMPLETED | FAILED
```

### Entity Relationships
```
User  1──* Account            (OAuth links)
User  1──* VerificationToken
User  1──* PasswordResetToken
User  1──* Repository
Repository 1──* AnalysisJob
```

### Key Fields

**User** (`users` table): `id`, `email` (unique), `password?`, `fullName?`, `avatar?`, `isEmailVerified`, `refreshToken?` (argon2 hash), timestamps.

**Account** (`accounts`): OAuth link per provider; unique on `(provider, providerId)` and `(userId, provider)`; `accessToken` + `refreshToken` stored AES-256-GCM encrypted; cascade-delete with user.

**VerificationToken** / **PasswordResetToken**: one-time tokens with `expiresAt`; reset tokens have `used` flag.

**Repository** (`repositories`): GitHub metadata, `localPath`, `status` (RepositoryStatus), `lastIndexedCommit`; unique on `(userId, githubRepoId)`.

**AnalysisJob** (`analysis_jobs`): `status`, `stage` (string — current pipeline step), `error?`, `queueJobId?`, `startedAt?`, `finishedAt?`; indexed on `repositoryId`.

---

## 6. Neo4j Knowledge Graph

Neo4j stores the code structure extracted by Graphify. **It is separate from Postgres** — Postgres tracks users/repos/jobs; Neo4j stores the actual code graph.

### Node Labels
`Repository`, `Directory`, `File`, `Class`, `Interface`, `Method`, `Function`

### Relationship Types
`CONTAINS`, `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `DEPENDS_ON`, `HAS_METHOD`

### Key Rule
Every node and relationship carries a `repositoryId` property. When a new analysis completes, **all prior nodes for that `repositoryId` are deleted and replaced** in a single transaction.

---

## 7. API Endpoints

All routes are prefixed `/api` unless noted. All routes require JWT **except** those marked `@Public()`.

### Health
| Method | Path | Notes |
|---|---|---|
| GET | `/api/` | Public. Returns `{ service, status, timestamp }`. |

### Auth (public)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | Body: `RegisterDto`. Sends verification email. Throttled. |
| POST | `/api/auth/login` | Body: `LoginDto`. Sets `nebula_access_token` + `nebula_refresh_token` HttpOnly cookies. Throttled. |
| POST | `/api/auth/refresh` | Uses `JwtRefreshGuard`. Reads refresh cookie. |
| POST | `/api/auth/verify-email` | Body: `{ token }`. |
| GET | `/api/auth/verify-email?token=` | Link-click flow; renders HTML. |
| POST | `/api/auth/forgot-password` | Body: `{ email }`. Always returns success (anti-enumeration). Throttled. |
| POST | `/api/auth/reset-password` | Body: `ResetPasswordDto`. Throttled. |
| GET | `/auth/github` | OAuth redirect (no `/api` prefix). |
| GET | `/auth/github/callback` | OAuth callback → sets cookies → redirects to frontend. |
| GET | `/auth/google` | OAuth redirect. |
| GET | `/auth/google/callback` | OAuth callback. |

### Auth (protected)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/logout` | Clears refresh token in DB + cookies. |
| POST | `/api/auth/change-password` | Body: `ChangePasswordDto`. Local accounts only. |
| GET | `/api/auth/me` | Returns user profile + linked accounts (tokens stripped). |

### Repositories (all protected)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/repositories/github` | Live GitHub repos. Query: `force`, `page`, `limit`. 5-min in-memory cache. |
| POST | `/api/repositories/import` | Body: `ImportRepositoryDto`. Persists to Postgres. |
| GET | `/api/repositories` | List imported repos for current user. |
| GET | `/api/repositories/:id` | Single repo detail. |
| DELETE | `/api/repositories/:id` | Delete imported repo. |
| POST | `/api/repositories/:id/analyze` | Enqueue analysis job. |
| GET | `/api/repositories/:id/analysis` | Latest `AnalysisJob` for repo (for polling). |

---

## 8. Auth Architecture

### Token Strategy
- Two JWT tokens: **access** (short TTL) + **refresh** (long TTL), separate secrets.
- Both stored as **HttpOnly cookies** (`nebula_access_token`, `nebula_refresh_token`); also accepted via `Authorization: Bearer`.
- Refresh token is **argon2-hashed** before storing on `User.refreshToken`. On reuse detection (hash mismatch), all sessions are cleared.

### OAuth (GitHub / Google)
- GitHub OAuth additionally stores the user's GitHub `accessToken` + `refreshToken` (AES-256-GCM encrypted) on the `Account` record — needed later for cloning private repos.
- OAuth links accounts by email; if an existing user signs in via OAuth the account is linked, not duplicated.

### Decorators
```typescript
@Public()          // Skip JwtAuthGuard on a route
@CurrentUser()     // Get full user from req.user
@CurrentUser('id') // Get just req.user.id
```

---

## 9. Analysis Pipeline

The pipeline runs inside a **BullMQ worker** (`AnalysisProcessor`) and is orchestrated by `AnalysisPipeline`. It updates `AnalysisJob.stage` at each step.

```
Stage name        | Service responsible
──────────────────|─────────────────────
"workspace"       | WorkspaceService.create()  → workspace/analysis-{jobId}/
"clone"           | GitService.clone()          → shallow clone with GitHub token
"discovery"       | DiscoveryService.detect()   → ProjectMetadata (framework/lang/pm)
"graphify"        | GraphifyService.run()        → graph.json (Graphify CLI)
"normalize"       | GraphNormalizerService       → NormalizedGraph (typed entities/rels)
"build_graph"     | GraphBuilderService          → KnowledgeGraph (adds repositoryId)
"save_neo4j"      | Neo4jService.saveGraph()     → delete old + insert new in transaction
"done"            | —                            → status COMPLETED, repo READY
```

Workspace is **always cleaned** in a `finally` block. On failure: stage is recorded, `AnalysisJob.status = FAILED`, `Repository.status = FAILED`.

**Job payload:**
```typescript
interface AnalysisJobPayload {
  repositoryId: string;
  analysisJobId: string;
  userId: string;
}
```

---

## 10. Graph Data Types

These types flow through the analysis pipeline:

```typescript
// From GraphifyService
interface GraphifyResult {
  nodes: GraphifyNode[];
  edges: GraphifyEdge[];
}

// After GraphNormalizerService
interface NormalizedGraph {
  entities: Entity[];
  relationships: Relationship[];
}

// After GraphBuilderService (ready for Neo4j)
interface KnowledgeGraph {
  repositoryNode: RepositoryNode;
  entities: Entity[];
  relationships: Relationship[];
}
```

Node types in `Entity`: `repository`, `directory`, `file`, `class`, `interface`, `method`, `function`.

---

## 11. Global Request/Response Pipeline

```
Request
  → ThrottlerGuard (rate limit)
  → JwtAuthGuard (unless @Public)
  → ValidationPipe (whitelist, forbidNonWhitelisted, transform)
  → Controller / Route Handler
  → ResponseInterceptor  →  { success: true, message: string, data: T }
  → HttpExceptionFilter  →  { success: false, message: string } (on errors)
```

---

## 12. Configuration & Environment

Typed config namespaces are loaded with `registerAs` from `src/config/`:

| Namespace | Key Variables |
|---|---|
| `app` | `NODE_ENV`, `PORT`, `FRONTEND_URL` |
| `database` | `DATABASE_URL` |
| `auth` | `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRATION` |
| `github` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` |
| `google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` |
| `mail` | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` |
| `encryption` | `ENCRYPTION_KEY` (64-hex or 32-char string → 32 bytes for AES-256) |
| `redis` | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| `workspace` | `WORKSPACE_ROOT` (default `./workspace`) |
| `graphify` | `GRAPHIFY_BIN`, `GRAPHIFY_ARGS`, `GRAPHIFY_TIMEOUT_MS` |
| `neo4j` | `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` |

> **Note:** `.env.example` omits Google OAuth vars. `google.config.ts` expects them.

---

## 13. Key Services Reference

| Service | Module | Responsibility |
|---|---|---|
| `TokenService` | `auth` | Issue JWT pair, argon2 hash/verify, crypto one-time tokens, cookie max-age parsing |
| `EncryptionService` | `common` | AES-256-GCM encrypt/decrypt for OAuth token storage |
| `GithubClientService` | `repositories` | GitHub REST API list with 5-min in-memory cache |
| `AnalysisPipeline` | `analysis` | Orchestrates all pipeline stages in order |
| `GraphifyService` | `graphify` | Exec Graphify CLI with `extract … --code-only --no-cluster` |
| `GraphNormalizerService` | `graph` | Map raw Graphify output to typed `Entity[]` + `Relationship[]` |
| `GraphBuilderService` | `graph` | Attach `repositoryId`, ensure root `Repository` node exists |
| `Neo4jService` | `neo4j` | Driver lifecycle; delete-and-replace graph in a transaction |
| `WorkspaceService` | `workspace` | Create/cleanup ephemeral dirs under `WORKSPACE_ROOT` |
| `DiscoveryService` | `discovery` | Detect Nest/Next/React/Vue/Express/Nx/Turbo from cloned repo |
| `GitService` | `git` | Authenticated shallow clone via `simple-git` |
| `MailService` | `mail` | SMTP send with Handlebars templates |

---

## 14. Adding a New Feature — Checklist

1. **New route** → add to the relevant controller; use `@Public()` if unauthenticated; annotate throttle if sensitive.
2. **New DB model** → add to `prisma/schema.prisma`; run `npx prisma migrate dev`; update `PrismaService` type refs.
3. **New pipeline stage** → add a new service in the relevant module; inject into `AnalysisPipeline`; add a stage name constant; update `AnalysisJob.stage` before calling the service.
4. **New config variable** → add a key to the relevant `src/config/*.config.ts` file and to `.env.example`.
5. **New Neo4j relationship** → add to `GraphNormalizerService` mapping logic and update the Neo4j Cypher in `Neo4jService`.
6. **Auth on new route** → it is protected by default; use `@CurrentUser('id')` to get the user ID; inject `PrismaService` to fetch the full user if needed.

---

## 15. Local Development Setup

```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Configure environment
cp .env.example .env
# Fill in: JWT secrets, OAuth credentials, ENCRYPTION_KEY, NEO4J_*, MAIL_*

# 3. Install Graphify CLI
# Place binary on PATH or set GRAPHIFY_BIN in .env

# 4. Set up DB
npx prisma migrate dev

# 5. Start dev server (watches src/)
npm run dev
```

**Test commands:**
```bash
npm test           # unit tests
npm run test:cov   # coverage
npm run test:e2e   # end-to-end
```

> The e2e spec in `test/app.e2e-spec.ts` is out of date (expects `"Hello World!"`). The real health endpoint returns JSON at `GET /api/`.

---

## 16. Conventions & Patterns to Follow

- **Response shape:** always return through `ResponseInterceptor` — return a plain object or `ApiResponse<T>`; do not manually wrap `{ success, data }`.
- **Errors:** throw NestJS `HttpException` subclasses (`NotFoundException`, `UnauthorizedException`, etc.); the global filter formats them.
- **No direct `req` access for user:** use `@CurrentUser()` decorator.
- **Prisma queries:** use `PrismaService` (injected); never create a new `PrismaClient`.
- **Secrets in DB:** always encrypt OAuth tokens via `EncryptionService`; never store plaintext.
- **Config values:** always read via `ConfigService.get<T>('namespace.key')`, never `process.env` directly.
- **DTOs:** every controller input needs a DTO with `class-validator` decorators.
- **Module exports:** only export what other modules need to import; keep services internal otherwise.
- **Cookie naming:** access cookie = `nebula_access_token`, refresh = `nebula_refresh_token`.
- **Branding in responses/emails:** use "Nebula" (not "Mizan").
