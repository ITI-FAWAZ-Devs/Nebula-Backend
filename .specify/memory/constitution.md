# Nebula-Backend Constitution
<!--
Sync Impact Report
- Version change: initial baseline -> 1.0.0
- Modified principles: template placeholders -> five Nebula-Backend principles.
- Added sections: Technology & Architecture Constraints; Delivery Requirements.
- Removed sections: none.
- Templates requiring updates: updated `.specify/templates/plan-template.md`,
  `.specify/templates/spec-template.md`, and `.specify/templates/tasks-template.md`.
- Follow-up TODOs: none.
-->

## Core Principles

### I. Empirically Verified Implementation (NON-NEGOTIABLE)

Code is the ultimate source of truth. Every endpoint, service method, and pipeline step
MUST be genuinely implemented, functional, and empirically verifiable. Dummy fallbacks,
swallowed exceptions, unverified stubs, and commentary-only assertions are prohibited.
Each change MUST include executable evidence appropriate to its risk before completion.

### II. Asynchronous Job Queuing & Pipeline Isolation

Cloning, discovery, tree-sitter AST parsing, Gemini summarization, ChromaDB indexing, and
Neo4j graph construction MUST execute asynchronously through BullMQ backed by Redis. Jobs
MUST report applicable ordered stages: `starting`, `workspace`, `clone`, `discovery`,
`describe_files`, `embed_descriptions`, `save_chroma` and/or `save_neo4j`, and `done`.
Every job MUST clean up its workspace on both completion and failure.

### III. Grounded RAG & Citation Transparency

AI-generated answers and documentation sections MUST be grounded exclusively in context
retrieved from ChromaDB or Neo4j. Every Q&A API response MUST include source files as
`citations: string[]`. Requests without retrievable grounding or citations MUST fail
explicitly rather than inventing support.

### IV. Clean Modular Architecture & Service Boundaries

Strict NestJS modules are `AuthModule`, `RepositoriesModule`, `AnalysisModule`, `GitModule`,
`WorkspaceModule`, `DiscoveryModule`, `GeminiModule`, `ChromaModule`, `GraphifyModule`, and
`Neo4jModule`. Controllers handle HTTP and DTO validation only; services own business logic;
pipeline classes own complex orchestration. Cross-module access MUST use explicit exports and
injected services.

### V. Security, Guard-First & Tenant Isolation

All API endpoints are protected by the global `JwtAuthGuard` unless explicitly annotated with
`@Public()`. GitHub and Google OAuth tokens MUST be encrypted at rest in PostgreSQL. Every
repository operation MUST verify `repository.userId === currentUser.id`; an ID alone is never
authorization.

## Technology & Architecture Constraints

- NestJS 11 with TypeScript and Express.
- PostgreSQL 18 with Prisma 7 and SQL migrations.
- Redis 7 with BullMQ; Neo4j for graphify AST entities; ChromaDB for vectors.
- Gemini 2.5 Flash for descriptions and Q&A; `gemini-embedding-001` for embeddings.
- Octokit for GitHub REST access and `simple-git` for local workspace cloning.

## Delivery Requirements

Plans and tasks MUST name each responsible module, service, or pipeline stage. API-answer work
MUST preserve `citations: string[]`; job work MUST define stage reporting and cleanup; database
changes MUST include Prisma and PostgreSQL-compatible SQL migration artifacts.

## Governance

This constitution supersedes informal practices. Amendments require a semantic version increment,
updated date, and Sync Impact Report. Plans, tasks, and reviews MUST verify compliance; any
exception requires explicit, time-bounded approval before merge.

**Version**: 1.0.0 | **Ratified**: 2026-07-25 | **Last Amended**: 2026-07-25
