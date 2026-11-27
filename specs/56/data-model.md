# Data model: #56

No new table or column. One existing table gets new rows; one enum gets new values.

## `AuditAction` enum (`prisma/schema/enums.prisma`)

New values (not enforced by D1, no migration):

| Value | Written by |
|---|---|
| `password_changed` | `POST /auth/change-password` |
| `session_signed_out` | `DELETE /auth/sessions/:sessionId` |
| `other_sessions_signed_out` | `DELETE /auth/sessions` |
| `password_reset_completed` | `POST /auth/reset-password` |

## `audit_log_entries` row for these actions

| Column | Value |
|---|---|
| `id` | UUIDv7 from `uuidv7()` (research D2) |
| `workspace_id` | `NULL` |
| `actor_id` | the user's id |
| `actor_name` | `users.full_name` at the time (copied in the statement) |
| `action` | one of the four values above |
| `target_type` | `'user'` |
| `target_id` | the user's id |
| `target_label` | `users.full_name` at the time |
| `data` | `session_signed_out`: `{"sessionId":"<ended session id>"}`; the other three: `{}` |
| `created_at`, `updated_at` | the same `now` as the change in that batch |

Rules:

- Exactly one row per successful action, written in the same `DB.batch` as the change.
- No row when the action fails (wrong current password, `CURRENT_SESSION`, `SESSION_NOT_FOUND`, invalid link) or loses a race (guard false).
- `DELETE /auth/sessions` with no other live session: the request still returns 204, and no row is written (nothing ended).
- `data` never holds emails, names, IPs or user agents. Rows are never updated or deleted by application code.
