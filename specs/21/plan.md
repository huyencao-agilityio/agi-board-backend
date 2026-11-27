# Implementation Plan: #21 Implement feature Invite to Workspace

**Branch**: `feat/21-invite-to-workspace` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/21/spec.md`

## Summary

A workspace admin invites people to the workspace by email with a role, sees the pending invites, resends and
revokes them. The invitee's side already exists from #6: invites appear on `GET /home`, and
`POST /invites/:id/accept|decline` work, including the expiry check and the race guards. This ticket adds the admin
side only:

- `POST   /workspaces/:workspaceId/invites`: create a workspace invite (14-day expiry), audit row, email.
- `GET    /workspaces/:workspaceId/invites`: list the pending workspace invites (valid and expired).
- `POST   /workspaces/:workspaceId/invites/:inviteId/resend`: reset the expiry to 14 days and send the email again,
  at most once per 60 s.
- `DELETE /workspaces/:workspaceId/invites/:inviteId`: revoke.

The `invites` table, its unique index on pending invites and the `invite` audit action already exist, so there is
no schema change. The dialog, the Members page and the Home rows are frontend work. See [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (tooling); runtime Cloudflare Workers

**Primary Dependencies**: NestJS 11, class-validator / class-transformer, Prisma 7.10 (D1 adapter)

**Storage**: Cloudflare D1 (SQLite). No schema change, no migration ([data-model.md](data-model.md)).

**Testing**: Jest: `pnpm test` (unit, permission table, email text), `pnpm test:e2e` (local D1 in `.wrangler/e2e`)

**Target Platform**: Cloudflare Workers (`wrangler dev` locally)

**Project Type**: web-service (REST API, `/api/v1`)

**Performance Goals**: N/A (each call is 1–3 queries, or one 2-statement batch)

**Constraints**: atomic writes only through `DB.batch`; email goes out after the write, fire-and-forget
(`EmailService` already does this); no personal data in logs or audit rows

**Scale/Scope**: 4 endpoints, 2 DTOs, 1 permission function, 1 email template, unit and e2e tests

## Constitution Check

`.specify/memory/constitution.md` is an unfilled template. The gates come from `AGENTS.md` and `.claude/rules/`.

| Gate | Status |
|---|---|
| Scope = the Trello card, nothing outside it | PASS. Board invites (#share board), in-app `invite` notifications and the outside-invite rule are not on the card (research R9) |
| Layers: module/controller/service/dto; Prisma or `DB.batch` directly | PASS |
| Auth is global; CSRF on writes; `@CurrentUser()` | PASS (no `@Public()`) |
| Permissions only in `src/modules/permissions/`, pure function plus table test | PASS (`canManageWorkspaceInvites`) |
| 404 rather than 403 for content the caller may not see | PASS (404 for a workspace the caller cannot see; 403 for a non-admin who can see it, as for board creation) |
| IDs server-generated; never taken from the client on create | PASS |
| Atomic writes through `DB.batch`; emails after the batch | PASS (invite + audit in one batch) |
| Personal data: no emails in URLs, logs or audit rows; only admins see invitee emails | PASS (email in the POST body; audit stores the invite id; list limited to admins) |
| Abuse: throttle email sends | PASS (60 s cooldown on resend and on re-inviting the same address; 50 new invites per hour per sender; research R4b) |
| e2e for HTTP behaviour, DB writes and concurrency-sensitive invites | PASS |
| No new dependency, no migration | PASS |

Re-check after design: PASS, no violations. Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/21/
├── spec.md
├── plan.md              # this file
├── research.md          # R1 routes … R10 existing pieces
├── data-model.md        # rows written; no schema change
├── quickstart.md
└── contracts/
    └── invites.md       # the 4 endpoints
```

### Source Code (repository root)

```text
src/modules/permissions/
├── board-access.ts                       # + canManageWorkspaceInvites
└── board-access.spec.ts                  # + its table
src/modules/email/
├── email.service.ts                      # + sendWorkspaceInvite
└── email.service.spec.ts                 # + text has inviter, workspace, link; no token
src/modules/invites/
├── dto/create-invite.dto.ts              # new: email (trim, lower case, IsEmail, ≤254), role? (admin|member)
├── dto/list-invites.dto.ts               # new: limit?, cursor?
├── workspace-invites.controller.ts       # new: @Controller('workspaces/:workspaceId/invites')
├── invites.service.ts                    # + create, list, resend, revoke
└── invites.module.ts                     # + controller, imports EmailModule
test/
└── workspace-invites.e2e-spec.ts         # new
```

**Structure Decision**: the new routes live in the existing `invites` module, next to accept/decline, because they
share the invite rules (`visibleInviteWhere`, error codes). A second controller carries the
`workspaces/:workspaceId/invites` prefix, as `WorkspacesController` does for boards. No new module.

## Decisions (confirmed by the user 2026-11-27)

- **Audit**: only *sending* an invite writes an audit row (`invite` action). The enum has no action for resend or
  revoke, and the BRD §10 list says "invites" (research R6).
- **429 code**: `RESEND_COOLDOWN`, as in the spec, separate from sign-up's `RESEND_TOO_SOON`.
- **Create throttle** (after security review): 60 s per workspace and email, 50 invites per hour per sender (research R4b).

## Complexity Tracking

None.
