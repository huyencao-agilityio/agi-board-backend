# Quickstart: validate #54 User logout

## Prerequisites

Worktree `agi-board-backend-54` with `.env` / `.dev.vars` copied from the main checkout, then `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`.

## Automated checks

```bash
pnpm lint && pnpm typecheck
pnpm test        # SessionService.logout unit cases
pnpm test:e2e    # POST /auth/logout cases + existing session/auth suites
```

The e2e cases map to the card's backend acceptance criteria and to [contracts/auth-logout.md](./contracts/auth-logout.md):

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Sign in with `POST /auth/sign-in`, then `POST /auth/logout` with the cookies and CSRF header | 204; the row has `endedAt` set and `endReason = logout` |
| 2 | Response of #1 | `Set-Cookie` clears the session cookie and `csrf_token` |
| 3 | `GET /auth/me` with the logged-out cookie | 401, `error.code` is not `SESSION_ENDED` |
| 4 | `POST /auth/logout` without the CSRF header, or with a wrong one | 403 `CSRF_INVALID`; the session stays live |
| 5 | `POST /auth/logout` again with the logged-out cookie | 204; `endedAt` unchanged |
| 6 | Session ended as `password_reset`, then logout | 204; `endReason` stays `password_reset` |
| 7 | No session cookie / unknown token | 401 |
| 8 | User with two sessions logs out of one | the other session still answers 200 on `GET /auth/me` |

## Manual check (optional)

```bash
pnpm start:dev
# 1. GET  http://localhost:8787/api/v1/health            -> note csrf_token cookie
# 2. POST /api/v1/auth/sign-in (X-CSRF-Token header)     -> session cookie set
# 3. POST /api/v1/auth/logout  (cookies + X-CSRF-Token)  -> 204, both cookies cleared
# 4. GET  /api/v1/auth/me      (old session cookie)      -> 401
```
