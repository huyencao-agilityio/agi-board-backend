# Quickstart: validate #4 User Sign In

Prerequisites: worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`); Google variables in `.dev.vars` only for the manual Google check. Contract: [contracts/auth-sign-in.md](./contracts/auth-sign-in.md).

## Automated

```bash
pnpm lint && pnpm typecheck
pnpm test        # password verify, throttle counting/lock/reset, Google claim checks
pnpm test:e2e    # test/auth.e2e-spec.ts
```

Expected: all exit 0. The e2e file covers, with `@e2e.test` addresses:

1. Valid sign-in → 200, `next: home`, cookie flags, `lastSignInAt` set.
2. Unverified user → 200, `next: verify-email`.
3. Wrong password and unknown email → same status, `error.code` and message.
4. Deactivated + correct password → 403 `ACCOUNT_DEACTIVATED`; deactivated + wrong password → 401.
5. Five wrong passwords → 6th is 429 `SIGN_IN_LOCKED`, also for an unknown email; the 6th is not counted; `reset(email)` unlocks.
6. Five parallel wrong passwords (`Promise.all`) → locked, count never above the limit.
7. Missing CSRF → 403 `CSRF_INVALID`; invalid email → 400 `VALIDATION_FAILED`.
8. Google callback with a faked token exchange: new user, existing password account (merged, one row), declined, failure, deactivated.
9. Session ended by admin → 401 `SESSION_ENDED`; ended by logout → plain 401.
10. Session idle for more than 7 days (set `last_active_at` back) → 401 `SESSION_ENDED` and the row gets `end_reason = expired`; a session idle for less keeps working and `last_active_at` refreshes at most once an hour.
11. `GET /auth/me`: 401 without a session; 200 with `user` + `next` after sign-in, `verify-email` when unverified.

Also run `pnpm db:check`: the new enum value must not produce a migration diff.

## Manual (once Google credentials exist)

1. `pnpm start:dev`, open `http://localhost:8787/api/v1/auth/google` in a browser.
2. Approve with any Google account → redirected to `/home` with the cookie set.
3. Repeat and decline → back on `/sign-in` with no message.
