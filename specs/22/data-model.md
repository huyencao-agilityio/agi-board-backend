# Data model: #22 Profile and Account Settings

No schema change and no migration. Everything uses existing tables and enum values.

## users (existing)

| Field | Use in this feature |
|---|---|
| `full_name` | Edited by `PATCH /users/me`; trimmed, not empty (CHECK `trim(full_name) <> ''`) |
| `avatar_object_key` | `avatars/<userId>/<uuid>` in R2 `IMAGES`, or `NULL` = initials avatar |
| `password_hash` | Replaced by change password; `NULL` → `hasPassword: false`, change password refused |
| `google_subject` | Only read: `googleLinked = google_subject IS NOT NULL`; never returned |
| `email` | Read only; used by the "no email name in password" rule |

## user_sessions (existing)

| Field | Use |
|---|---|
| `id` | Session id in the list and in `DELETE /auth/sessions/:sessionId` |
| `user_agent` | Returned raw to the owner only |
| `created_at`, `last_active_at` | Returned; list sorted by `last_active_at` desc |
| `ended_at`, `end_reason` | Set together (CHECK). New values written here: `password_changed` (change password, other sessions), `signed_out_by_user` (one session / all others) |
| `ip_address` | Not returned |

Live session = `ended_at IS NULL` and `last_active_at` within `SESSION_IDLE_DAYS`.

## auth_throttles (existing)

Scope `change_password`, `subject_key = sha256(userId)` via `throttleKey`. `failed_count`, `locked_until` as for sign-in: 5 wrong current passwords → locked 15 minutes. Row deleted once the current password is verified; an unlocked row idle for 15 minutes restarts at 0.

## password_reset_tokens (existing)

A successful password change sets `voided_at` on the user's unused links (same batch).

## R2 objects (IMAGES)

`avatars/<userId>/<uuid>`, `httpMetadata.contentType` = detected type (`image/jpeg|png|webp|gif`), ≤ 5 MB. One live object per user (the swap is conditional, research D5); the previous one is deleted after the DB points to the new one (or to `NULL`).
