# Quickstart: validate #56

## Prerequisites

Worktree set up (`pnpm install`, `pnpm db:migrate`). No env change.

## Checks

```bash
pnpm db:check        # enum values only: no pending migration
pnpm lint && pnpm typecheck
pnpm test            # uuidv7 unit test
pnpm test:e2e        # account-security + password-reset files
```

## E2E scenarios (add to `test/account-security.e2e-spec.ts` and `test/password-reset.e2e-spec.ts`)

Each "row" assertion reads `audit_log_entries` by `actor_id` and checks: exactly one row, the right `action`, `actor_id = target_id = user.id`, `workspace_id` null, `target_type = 'user'`, `actor_name = target_label = full name`, and `data` as in [data-model.md](./data-model.md) (no email, IP, or user agent).

| # | Scenario | Expected |
|---|---|---|
| 1 | change password, correct current password | 204; one `password_changed` row, `data` `{}` |
| 2 | change password, wrong current password | 400; no row |
| 3 | change password and reset fired together (new `Promise.all` case) | a row only for the request that succeeded; none for the loser |
| 4 | `DELETE /auth/sessions/:id` on another live session | 204; one `session_signed_out` row, `data.sessionId` = that id |
| 5 | `DELETE /auth/sessions/:id` unknown / other user's / already ended / idle past `SESSION_IDLE_DAYS` | 404; no row |
| 6 | `DELETE /auth/sessions/:id` on the current session | 400 `CURRENT_SESSION`; no row |
| 7 | `DELETE /auth/sessions` with other live sessions | 204; one `other_sessions_signed_out` row, `data` `{}` |
| 8 | `DELETE /auth/sessions` with none to end | 204; no row (proves the `changes()` guard, research D3) |
| 9 | reset password, valid link | one `password_reset_completed` row, `data` `{}` |
| 10 | reset password, invalid/used link, and the parallel-reset race test | no row for the loser; exactly one row in total |

Cleanup: delete the test users' `audit_log_entries` before deleting the users (research D6).
