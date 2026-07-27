import { DraftSection } from '../../src/architecture-doc/dto/architecture-draft.dto';

export const seededHallucinationSection: DraftSection = {
  key: 'hallucinated-section',
  title: 'Authentication Module',
  contentMd: `## Authentication Module

The authentication module uses OAuth2 with GitHub and Google providers [src/auth/github-oauth.ts].
Password hashing is done with bcrypt [src/utils/crypto.ts].
Session management uses Redis with TTL of 24 hours [src/session/redis-session.ts].

### Security Features
- Rate limiting on login attempts [src/middleware/rate-limiter.ts]
- JWT token rotation on every request [src/auth/jwt-rotation.ts]`,
  sourceFiles: [
    'src/auth/github-oauth.ts',
    'src/utils/crypto.ts',
    'src/session/redis-session.ts',
    'src/middleware/rate-limiter.ts',
    'src/auth/jwt-rotation.ts',
  ],
  verdict: 'unverified',
  verificationNotes: null,
};
