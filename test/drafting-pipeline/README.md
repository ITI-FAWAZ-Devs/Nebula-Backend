# Drafting Pipeline Test Fixtures

## Overview

This directory contains test fixtures for the architecture drafting pipeline.

## Files

### `minimal-repo.ts`
A minimal three-file fixture repository representing a simple NestJS application. Used for SC-001 (grounded citations) and SC-002 (repository-specific structure) tests.

### `seeded-hallucination.ts`
A fixture section with deliberately unsupported claims and citations. Used for SC-003 (hallucination detection) tests.

### Expected Roles

- **SC-001**: Verify that generated sections cite file paths that exist in the fixture repository evidence.
- **SC-002**: Verify that different repositories produce different section plans based on their evidence.
- **SC-003**: Verify that the verifier catches deliberately unsupported content (hallucination detection).
- **SC-004**: Verify that diagram generation uses only evidenced modules.
- **SC-005**: Verify that every verified section has at least one supporting cited file.
- **SC-006**: Verify tenant isolation (all retrieval calls scoped by repositoryId).
