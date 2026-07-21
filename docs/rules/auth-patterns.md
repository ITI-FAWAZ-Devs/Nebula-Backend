---
description: Auth patterns, JWT strategy, OAuth flow, and security conventions
globs: src/auth/**,src/users/**,src/common/**
alwaysApply: false
---

# Auth Patterns

## Token Strategy
- **Access JWT** — short TTL, secret = `JWT_ACCESS_SECRET`
- **Refresh JWT** — long TTL, secret = `JWT_REFRESH_SECRET`
- Both stored as **HttpOnly cookies** and also accepted via `Authorization: Bearer`
- Refresh token is **argon2-hashed** before saving to `User.refreshToken`
- On refresh token reuse (hash mismatch) → all sessions cleared (security: rotation theft detection)

## Guards & Strategies
| Guard | Strategy | Usage |
|---|---|---|
| `JwtAuthGuard` (global) | `jwt` | Protects all routes by default |
| `JwtRefreshGuard` | `jwt-refresh` | `POST /auth/refresh` only |
| `GithubAuthGuard` | `github` | OAuth routes |
| `GoogleAuthGuard` | `google` | OAuth routes |

## Decorators
```typescript
@Public()           // Bypass JwtAuthGuard — use on register, login, verify, forgot, reset
@CurrentUser()      // Injects full req.user into param
@CurrentUser('id')  // Injects req.user.id — prefer this over full user for efficiency
```

## OAuth Account Linking
- Accounts linked by **email match** — if the email is already in Postgres, the OAuth account is attached to the existing user
- GitHub OAuth additionally saves the GitHub `accessToken` + `refreshToken` (AES-256-GCM encrypted) on the `Account` record — these are used later for repo cloning
- `Account` unique constraints: `(provider, providerId)` and `(userId, provider)`

## Security Rules
- Passwords: always hash with **argon2** via `TokenService.hashPassword()`
- OAuth tokens: always encrypt via `EncryptionService.encrypt()` before storing; decrypt on read
- Password forgot/reset: always return a generic success message (anti-enumeration)
- Rate limiting on sensitive routes: use `@Throttle({ default: { limit, ttl } })`

## Cookie Names
- Access token: `nebula_access_token`
- Refresh token: `nebula_refresh_token`
