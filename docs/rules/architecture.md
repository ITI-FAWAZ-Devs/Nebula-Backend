---
description: Core architecture, module layout, and conventions for the Nebula NestJS backend
alwaysApply: true
---

# Nebula Backend — Architecture & Conventions

## Stack
NestJS 11 + TypeScript 5.7 | PostgreSQL (Prisma 7) | Neo4j | BullMQ + Redis | Passport JWT + OAuth

## Module Layout
```
src/
  analysis/     BullMQ queue, worker, pipeline orchestration
  auth/         JWT/OAuth auth, strategies, guards, token service
  common/       Shared decorators (@Public, @CurrentUser), filters, interceptors, encryption
  config/       Typed env namespaces (registerAs)
  discovery/    Framework/language detection from cloned repo
  git/          simple-git authenticated shallow clone
  graph/        Graphify output normalization → typed graph entities
  graphify/     Graphify CLI runner (execa)
  mail/         Nodemailer + Handlebars templates
  neo4j/        Neo4j driver + graph save/replace
  prisma/       Global PrismaService (@Global)
  repositories/ GitHub repo listing, import, CRUD
  users/        User/account/token DB operations
  workspace/    Ephemeral analysis directory management
```

## Request Pipeline
`ThrottlerGuard → JwtAuthGuard → ValidationPipe → Handler → ResponseInterceptor / HttpExceptionFilter`

## Rules
- Every route is JWT-protected by default; use `@Public()` to opt out
- Use `@CurrentUser('id')` — never read `req.user` directly
- Always read config via `ConfigService.get<T>('namespace.key')` — never `process.env`
- Throw NestJS `HttpException` subclasses for errors; the global filter formats them
- Return plain objects from handlers; `ResponseInterceptor` wraps them as `{ success, message, data }`
- All DTOs must use `class-validator` decorators; `ValidationPipe` is global with `whitelist: true`
- Encrypt OAuth tokens via `EncryptionService` (AES-256-GCM) — never store plaintext
- Use `PrismaService` for all DB access — never `new PrismaClient()`
- Branding in responses/emails/cookies: use **Nebula** (not Mizan)
- Cookies: `nebula_access_token` (access JWT), `nebula_refresh_token` (refresh JWT)
