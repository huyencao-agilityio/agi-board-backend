# Quickstart: #21 Invite to Workspace

## Prerequisites

Worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`).

## Automated check

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected:

- `src/modules/permissions/board-access.spec.ts`: the `canManageWorkspaceInvites` table passes.
- `src/modules/email/email.service.spec.ts`: the invite email has the inviter, the workspace and the app link.
- `test/workspace-invites.e2e-spec.ts` passes:

| Scenario | Expected |
|---|---|
| Admin posts `{ "email": " New@E2E.test " }` | 201, `email: "new@e2e.test"`, `role: "member"`, `expiresAt` ≈ now + 14 d; DB: 1 pending invite, 1 `invite` audit row with `target_id` = invite id and no email |
| Admin posts the same address again | 409 `INVITE_PENDING` |
| Two parallel posts of a new address (`Promise.all`) | one 201, one 409 `INVITE_PENDING`; 1 row in DB |
| Admin invites an existing member's address | 409 `ALREADY_MEMBER` |
| Bad email, `role: "owner"`, unknown field, bad UUID | 400 `VALIDATION_FAILED` |
| Workspace member / board-only member calls any route | 403 `INVITE_MANAGE_FORBIDDEN` |
| Outsider, archived workspace, unknown id | 404 `WORKSPACE_NOT_FOUND` |
| No session / no CSRF header on a write | 401 / 403 `CSRF_INVALID` |
| `GET` list | pending workspace invites only (not board invites, accepted, declined or revoked); expired ones have `expired: true`; `limit=1` gives a `nextCursor` |
| Resend right after create | 429 `RESEND_COOLDOWN` with `details.retryAfterSeconds` 1–60 |
| Create, revoke, create the same address within 60 s | 429 `RESEND_COOLDOWN`; another workspace → 201 |
| 51st invite created by one person within an hour | 429 `INVITE_RATE_LIMITED` |
| Resend an expired invite whose `lastSentAt` is > 60 s ago | 200, `expired: false`, `expiresAt` ≈ now + 14 d; the invitee can then accept it |
| Two parallel resends (`Promise.all`) | one 200, one 429 |
| Revoke | 204; gone from the list and from the invitee's `GET /home`; accept → 404 `INVITE_NOT_FOUND` |
| Revoke or resend an accepted / revoked invite, or another workspace's invite | 404 `INVITE_NOT_FOUND` |
| Invitee accepts | joins with the invited role (existing #6 behaviour, one regression test) |

## Manual check (optional)

`pnpm start:dev` with Mailpit running (`docker compose up`), sign in as a workspace admin and
`POST http://localhost:8787/api/v1/workspaces/<id>/invites` with the session and CSRF cookies plus the CSRF header.
The email appears in Mailpit (http://localhost:8025). Sign up or sign in with that address: the invite is on
`GET /api/v1/home`. See [contracts/invites.md](contracts/invites.md).
