# Contract: change password and active sessions (`/api/v1/auth`)

All routes need a session (401 without one, 401 `SESSION_ENDED` for an ended one). Writes need the CSRF header (403 `CSRF_INVALID`).

## POST /auth/change-password

Body `{ "currentPassword": "...", "newPassword": "..." }` (both strings, not empty). 204: password replaced, every **other** live session ended (`end_reason = password_changed`), every unused reset link voided; the current session stays signed in.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Missing/unknown fields, `currentPassword` over 128 characters; or `newPassword` breaks a rule (one `details` entry per rule, same messages as sign-up/reset) |
| 400 | `PASSWORD_NOT_SET` | The account has no password (Google-only) |
| 400 | `CURRENT_PASSWORD_INCORRECT` | Wrong current password (counted toward the limit) |
| 429 | `CHANGE_PASSWORD_LOCKED` | 5 wrong current passwords within 15 minutes; sign-in is not affected. A right current password clears the count |

Order: account has a password → attempt counted (429 when locked) → current password checked → new-password rules. A wrong current password is answered before the new-password rules, so the rules never confirm a guess.

## GET /auth/sessions

200:

```json
{
  "items": [
    {
      "id": "0193...",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": "2026-11-20T08:00:00.000Z",
      "lastActiveAt": "2026-11-26T03:00:00.000Z",
      "isCurrent": true
    }
  ]
}
```

Live sessions only (not ended, not idle past `SESSION_IDLE_DAYS`), newest `lastActiveAt` first. `userAgent` may be `null`. No IP address. Not paginated. `lastActiveAt` is refreshed at most hourly.

## DELETE /auth/sessions/:sessionId

204: that session ended (`end_reason = signed_out_by_user`); its device gets 401 `SESSION_ENDED` on its next request.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `sessionId` is not a UUID |
| 400 | `CURRENT_SESSION` | It is the caller's own session (use `POST /auth/logout`) |
| 404 | `SESSION_NOT_FOUND` | Unknown, already ended, idle past `SESSION_IDLE_DAYS`, or another user's session |

## DELETE /auth/sessions

204: every live session of the user except the current one ended (`signed_out_by_user`). Also 204 when there were none.
