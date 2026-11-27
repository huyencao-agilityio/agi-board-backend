# Research: #56 Audit log for self-service account security actions

Decisions taken while planning. Clarifications Q1–Q3 in `spec.md` are inputs, not repeated here.

## D1. One shared insert helper, `INSERT … SELECT` from `users`

- **Decision:** `src/common/audit-log.ts` exports `auditStatement(DB, { action, userId, now, data }, guardSql, guardBinds)`, which returns one D1 prepared statement:
  ```sql
  INSERT INTO audit_log_entries (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at)
  SELECT ?{k+1}, NULL, u.id, u.full_name, ?{k+2}, 'user', u.id, u.full_name, ?{k+3}, ?{k+4}, ?{k+4}
  FROM users u WHERE u.id = ?{k+5} AND (<guard>)
  ```
  Each caller passes the guard it already uses, so the row exists only if the change happened. The guard's binds go **first** (`?1..?k`), so `newHashInPlace` (`?1`/`?3`) and `LINK_IS_VALID` (`?1`/`?2`) are reused verbatim with the same bind array as their own statements; the helper's values are numbered after `k`.
- **Rationale:** reading `full_name` inside the statement copies the name at the time without an extra read, and in the same batch. A false guard selects no row, so nothing is inserted and the batch still succeeds. One helper keeps the four call sites the same.
- **Alternatives:** Prisma `auditLogEntry.create` after the change (not atomic on D1, against `database.md`); a value from `SessionUser.fullName` (not available on reset, which has no session).

## D2. Row id: a small UUIDv7 helper

- **Decision:** `uuidv7()` in `src/common/audit-log.ts` (48-bit ms timestamp + `crypto.getRandomValues`, version/variant bits set), with a unit test for format, version, and time order.
- **Rationale:** raw SQL bypasses Prisma's `@default(uuid(7))`; AGENTS.md requires UUIDv7 ids. Workers has `crypto.getRandomValues` but no v7 generator; ~10 lines beats a new dependency (`security.md` → Dependencies).
- **Alternatives:** `crypto.randomUUID()` (v4, breaks the id convention and time ordering); adding the `uuid` package.

## D3. Guards per action

| Action | Batch | Guard on the insert |
|---|---|---|
| `password_changed` | existing batch in `AccountSecurityService.changePassword` | `newHashInPlace` (the same `EXISTS` the other statements use) |
| `password_reset_completed` | existing batch in `PasswordResetService.applyReset`, inserted **before** the final "mark link used" statement | `LINK_IS_VALID` |
| `session_signed_out` | new batch: raw `UPDATE user_sessions` + insert | `changes() > 0` |
| `other_sessions_signed_out` | new batch: raw `UPDATE user_sessions` + insert | `changes() > 0` |

- **`changes()`:** SQLite's `changes()` returns the rows changed by the previous statement on the same connection. A D1 batch runs its statements in order in one transaction, so the insert placed right after the `UPDATE` sees that statement's count. This is exact (no timestamp match). **Verify first** with the e2e "no row when nothing ended" case. If D1 does not keep `changes()` across batch statements, fall back to `EXISTS (SELECT 1 FROM user_sessions WHERE user_id = ? AND ended_at = ?now AND end_reason = 'signed_out_by_user')`.
- **Reset ordering:** the code checks `results[results.length - 1]` (the link update) for success; the insert goes before it so that index stays the link update and `LINK_IS_VALID` is still true when the insert runs.
- **Ending sessions:** `endSession` and `endOtherSessions` move from Prisma `updateMany` to raw SQL in `DB.batch`, keeping the same filters (`user_id`, `ended_at IS NULL`, `id <> current`, and for one session `last_active_at > liveSince`) and the same `end_reason = 'signed_out_by_user'`. `endSession` still returns 404 `SESSION_NOT_FOUND` when `results[0].meta.changes === 0`, and 400 `CURRENT_SESSION` before any query.
- **`sqlDate`:** both services already define the same `sqlDate`; move it to `src/common/audit-log.ts` next to the helper and import it in both (no third copy).

## D4. `target_type`

- **Decision:** `'user'` (the user is both actor and target).
- **Rationale:** the column is free text; the deferred item from clarify. `user` names the target entity, matching the model name.

## D5. Enum values, no migration

- **Decision:** add `password_changed`, `session_signed_out`, `other_sessions_signed_out`, `password_reset_completed` to `enum AuditAction` in `prisma/schema/enums.prisma`. D1 stores the column as `TEXT` with no CHECK, so no SQL migration; `pnpm db:check` must stay clean.

## D6. Test cleanup

- `audit_log_entries.actor_id` references `users` with `ON DELETE NO ACTION`. E2E files that delete their test users (`account-security`, `password-reset`) must delete those users' audit rows first, or cleanup fails. Application code never deletes audit rows (`security.md`).
