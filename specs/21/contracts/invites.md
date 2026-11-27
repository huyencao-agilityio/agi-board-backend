# Contract: workspace invites (admin side)

All routes: prefix `/api/v1`, session cookie required (401 without it, as on every route), writes need the
`csrf_token` cookie and the `X-CSRF-Token` header (403 `CSRF_INVALID`). Errors use
`{ error: { code, message, details? } }`.

Common errors for every route below:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | bad body/query, unknown field, path id not a UUID |
| 403 | `INVITE_MANAGE_FORBIDDEN` | the caller can see the workspace but is not its admin |
| 404 | `WORKSPACE_NOT_FOUND` | unknown, archived, or not visible to the caller |

## `InviteItem`

```json
{
  "id": "0193…",
  "email": "new.person@example.com",
  "role": "member",
  "expiresAt": "2026-12-11T09:00:00.000Z",
  "lastSentAt": "2026-11-27T09:00:00.000Z",
  "expired": false,
  "invitedBy": { "id": "0192…", "fullName": "Ada Admin" }
}
```

## POST `/workspaces/:workspaceId/invites`

Body: `{ "email": "New.Person@Example.com ", "role": "member" }`. `email` is trimmed and lower-cased, must be a
valid address of at most 254 characters. `role` is `admin` or `member`, default `member`.

| Status | Body / code | When |
|---|---|---|
| 201 | `InviteItem` | invite created, audit row written, email queued |
| 409 | `ALREADY_MEMBER` | the address belongs to a member of this workspace |
| 409 | `INVITE_PENDING` | a pending invite (expired or not) exists for this address in this workspace |
| 429 | `RESEND_COOLDOWN`, `details: { "retryAfterSeconds": n }` | an invite to this address here was sent less than 60 s ago and has since been revoked or answered |
| 429 | `INVITE_RATE_LIMITED` | the caller created 50 invites in the last hour (all workspaces) |

## GET `/workspaces/:workspaceId/invites?limit=&cursor=`

`limit` 1–100 (default 50); `cursor` = the last invite id of the previous page.

| Status | Body |
|---|---|
| 200 | `{ "items": InviteItem[], "nextCursor": string \| null }`: pending workspace invites, newest first, expired included |

## POST `/workspaces/:workspaceId/invites/:inviteId/resend`

No body.

| Status | Body / code | When |
|---|---|---|
| 200 | `InviteItem` | `expiresAt` = now + 14 days, `lastSentAt` = now, `expired: false`; email queued |
| 404 | `INVITE_NOT_FOUND` | unknown, not a workspace invite of this workspace, or no longer pending |
| 429 | `RESEND_COOLDOWN`, `details: { "retryAfterSeconds": 42 }` | last sent less than 60 s ago |

## DELETE `/workspaces/:workspaceId/invites/:inviteId`

| Status | Body / code | When |
|---|---|---|
| 204 | — | revoked (expired invites too); it disappears from the list and from the invitee's Home |
| 404 | `INVITE_NOT_FOUND` | unknown, not a workspace invite of this workspace, or no longer pending |

## Unchanged (from #6)

`GET /home` (`invites[]`), `POST /invites/:inviteId/accept`, `POST /invites/:inviteId/decline`. After a revoke,
accept and decline answer 404 `INVITE_NOT_FOUND`. After a resend, accept works again on an invite that had expired.
