# Contract: Auth logout

Base path `/api/v1`. Errors use `{ error: { code, message, details } }`; clients branch on `code`. The route is `@Public()`: it does its own session-cookie check (see research D1). It needs the `csrf_token` cookie plus the `X-CSRF-Token` header. It takes no body.

## POST /auth/logout

| Case | Status | Body / `error.code` | Session row | `Set-Cookie` |
|------|--------|---------------------|-------------|--------------|
| Live session cookie | 204 | none | `endedAt = now`, `endReason = logout` | session cookie and `csrf_token` cleared (expired, `path=/`) |
| Session already ended (by logout or anything else) | 204 | none | unchanged | both cleared |
| No session cookie | 401 | `UNAUTHORIZED` | none | none |
| Session cookie matching no session | 401 | `UNAUTHORIZED` | none | none |
| Missing or wrong CSRF token | 403 | `CSRF_INVALID` | unchanged | none |

Only the cookie's own session is ended. Other sessions of the same user stay live.

## After logout

Any protected route called with the logged-out session cookie answers 401 `UNAUTHORIZED`, not `SESSION_ENDED`, so the frontend shows no "You were signed out" notice. This is existing `SessionGuard` behavior.
