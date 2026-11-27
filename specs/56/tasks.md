---
description: "Task list for #56 audit log for self-service account security actions"
---

# Tasks: #56 Decide and implement audit log for self-service account security actions

**Input**: `specs/56/` (spec.md, plan.md, research.md, data-model.md, contracts/http.md, quickstart.md)

**Tests**: requested by the card ("E2E: one row per action … no row when the action fails") and by `.claude/rules/testing.md`.

The card has no user stories; they are grouped by flow:

- **US1 (P1)**: credential changes: change password and password reset completed write one audit row.
- **US2 (P2)**: session sign-outs: sign out one session and sign out all other sessions write one audit row.

Every row follows data-model.md: `workspace_id` = `NULL`, `actor_id` = `target_id` = the user's id, `actor_name` = `target_label` = `users.full_name` at the time, `target_type` = `'user'`, `created_at` = `updated_at` = the batch's `now`. `data`: `session_signed_out` → `{"sessionId":"<ended session id>"}`; the other three → `{}`. No emails, names, IPs or user agents in `data`.

## Phase 1: Setup

- [X] T001 Add `password_changed`, `session_signed_out`, `other_sessions_signed_out`, `password_reset_completed` to `enum AuditAction` in prisma/schema/enums.prisma; run `pnpm prisma generate`, then `pnpm db:check` (must report no pending migration: D1 does not enforce enums, research D5)

## Phase 2: Foundational (blocks US1 and US2)

- [X] T002 Create src/common/audit-log.ts exporting: `uuidv7()` (48-bit ms timestamp big-endian + `crypto.getRandomValues` for the rest, version nibble `7`, variant bits `10`, lowercase 8-4-4-4-12 string; research D2); `sqlDate(date)` = `date.toISOString().replace('Z', '+00:00')` (moved from the two services); `auditStatement(DB: D1Database, entry: { action: AuditAction; userId: string; now: string; data?: Record<string, string> }, guardSql: string, guardBinds: unknown[])` returning one prepared `INSERT INTO audit_log_entries (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at) SELECT ?{k+1}, NULL, u.id, u.full_name, ?{k+2}, 'user', u.id, u.full_name, ?{k+3}, ?{k+4}, ?{k+4} FROM users u WHERE u.id = ?{k+5} AND (<guardSql>)` (research D1). Placeholders: `guardBinds` are bound **first** at `?1..?k` (k = `guardBinds.length`), so the services' existing guard strings (`newHashInPlace` uses `?1`/`?3`, `LINK_IS_VALID` uses `?1`/`?2`) work verbatim when the caller passes the same bind array as the statement they come from; the helper's own values (id, action, `JSON.stringify(data ?? {})`, now, userId) use numbered placeholders after `k`. Only fixed SQL strings are interpolated; never concatenate request values into SQL. Import `AuditAction` from `../generated/prisma/enums`. One-line JSDoc on each export.
- [X] T003 [P] Unit test src/common/audit-log.spec.ts: `uuidv7()` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`, two ids generated 2 ms apart sort in time order (fake timers), 1000 ids are unique; `sqlDate(new Date('2026-01-02T03:04:05.006Z'))` === `'2026-01-02T03:04:05.006+00:00'`
- [X] T004 Replace the local `sqlDate` in src/modules/auth/account/account-security.service.ts and src/modules/auth/password-reset/password-reset.service.ts with the import from src/common/audit-log.ts (no behavior change)
- [X] T005 Audit cleanup in test/account-security.e2e-spec.ts and test/password-reset.e2e-spec.ts: before `prisma.user.deleteMany`, delete `auditLogEntry` rows whose `actorId` is one of those users (FK `ON DELETE NO ACTION`, research D6); add a small helper in each file `auditRows(userId)` = `prisma.auditLogEntry.findMany({ where: { actorId: userId } })`

**Checkpoint**: `pnpm typecheck`, `pnpm test`, and the existing `pnpm test:e2e` all pass with no behavior change.

## Phase 3: User Story 1 — credential changes (P1) 🎯 MVP

**Goal**: change password and password reset completed each write exactly one row in the same batch.

**Independent test**: quickstart.md scenarios 1, 2, 3, 9, 10.

### Tests

- [X] T006 [P] [US1] In test/account-security.e2e-spec.ts (`POST /auth/change-password`): successful change → exactly one row with `action` `password_changed`, `data` `{}` and the common fields above; wrong current password (400 `CURRENT_PASSWORD_INCORRECT`) → no row; **new** race case (none exists today): fire `POST /auth/change-password` and `POST /auth/reset-password` (valid link for the same user) together with `Promise.all`, then assert a `password_changed` row exists only if change-password answered 204, and a `password_reset_completed` row only if the reset succeeded (the loser writes none). Compare `data` after parsing (`typeof data === 'string' ? JSON.parse(data) : data`)
- [X] T007 [P] [US1] In test/password-reset.e2e-spec.ts (`POST /auth/reset-password`): valid link → exactly one `password_reset_completed` row, `data` `{}`, common fields; invalid/used/expired link → no row; in the existing parallel-reset race test → exactly one row in total. Compare `data` after parsing, as in T006

### Implementation

- [X] T008 [US1] In `AccountSecurityService.changePassword` (src/modules/auth/account/account-security.service.ts) append `auditStatement(DB, { action: 'password_changed', userId: user.id, now }, newHashInPlace, [newHash, now, user.id])` (same positions as the statements that use `newHashInPlace`: `?1` hash, `?3` user id) to the existing `DB.batch`, guarded by the same `EXISTS (SELECT 1 FROM users WHERE id = … AND password_hash = …)` condition as the other statements, so a lost race writes no row; keep `updated.meta.changes !== 1 → currentPasswordIncorrect()` reading index 0
- [X] T009 [US1] In `PasswordResetService.applyReset` (src/modules/auth/password-reset/password-reset.service.ts) insert `auditStatement(DB, { action: 'password_reset_completed', userId: user.id, now }, LINK_IS_VALID, [linkId, now])` **before** the final `UPDATE password_reset_tokens SET used_at …` statement, so `LINK_IS_VALID` still holds and `results[results.length - 1]` stays the link update (research D3)

**Checkpoint**: T006–T007 pass.

## Phase 4: User Story 2 — session sign-outs (P2)

**Goal**: sign out one session and sign out all other sessions each write exactly one row in the same batch, only when a session actually ended.

**Independent test**: quickstart.md scenarios 4–8.

### Tests

- [X] T010 [US2] In test/account-security.e2e-spec.ts (`active sessions`): `DELETE /auth/sessions/:id` on another live session → one `session_signed_out` row with `data` `{"sessionId": target.id}`; unknown id / other user's session / already-ended session / session idle longer than `SESSION_IDLE_DAYS` (proves the raw `last_active_at > sqlDate(liveSince)` string comparison, which must match how Prisma stores dates) → 404 `SESSION_NOT_FOUND` and no row; a session active 1 day ago (inside the idle window) still ends with 204; current session → 400 `CURRENT_SESSION` and no row; `DELETE /auth/sessions` with other live sessions → one `other_sessions_signed_out` row, `data` `{}`; `DELETE /auth/sessions` with none to end → 204 and no row (proves the `changes()` guard)

### Implementation

- [X] T011 [US2] Rewrite `endSession` in src/modules/auth/account/account-security.service.ts: keep the `CURRENT_SESSION` 400 check first; then `DB.batch([UPDATE user_sessions SET ended_at = now, end_reason = 'signed_out_by_user', updated_at = now WHERE id = ? AND user_id = ? AND ended_at IS NULL AND last_active_at > sqlDate(liveSince(now)), auditStatement(DB, { action: 'session_signed_out', userId: user.id, now, data: { sessionId } }, 'changes() > 0', [])])`; throw 404 `SESSION_NOT_FOUND` when `results[0].meta.changes === 0`
- [X] T012 [US2] Rewrite `endOtherSessions` the same way: `UPDATE user_sessions SET ended_at = now, end_reason = 'signed_out_by_user', updated_at = now WHERE user_id = ? AND ended_at IS NULL AND id <> ?` + `auditStatement(…'other_sessions_signed_out'…, 'changes() > 0', [])`; still returns 204 when nothing ended
- [X] T013 [US2] (Not needed: `changes()` works in a D1 batch, the "none to end" e2e case passes.) If T010's "none to end" or the single-session case fails because D1 does not keep `changes()` across batch statements, replace the guard with `EXISTS (SELECT 1 FROM user_sessions WHERE user_id = ? AND ended_at = ? AND end_reason = 'signed_out_by_user')` (plus `id = ?` for one session) and note it in research.md D3; otherwise mark done with no change

**Checkpoint**: T010 passes, existing session tests still pass.

## Phase 5: Polish

- [X] T014 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:check`; fix until all exit 0
- [X] T015 Run the `code-reviewer` and `security-auditor` agents (the change touches auth and raw SQL); fix Critical/High findings

## Dependencies

- T001 → T002 → T004, T008, T009, T011, T012
- T003, T005 parallel after T002
- T006, T007, T010 after T005 (same e2e files)
- US1 (T006–T009) and US2 (T010–T013) are independent after Phase 2; both edit account-security.service.ts and account-security.e2e-spec.ts, so do them one after another if one person works alone
- T014–T015 last

## Parallel example

After T002: T003 (unit test) ∥ T005 (e2e cleanup). After T005: T006 ∥ T007 (different files).

## Implementation strategy

MVP = Phases 1–3 (credential changes are the highest-risk actions for account takeover). Then Phase 4, then Phase 5 before `/create-pr`.
