# Research: #21 Invite to Workspace

Card items that belong to the frontend (invite dialog, Members page, Home rows) are out of scope for the backend.
Accept and decline already exist (specs/6, `src/modules/invites/`). This file covers the backend decisions for the
admin side.

## R1. Routes

- **Decision:** nest everything under the workspace:
  `POST/GET /workspaces/:workspaceId/invites`, `POST /workspaces/:workspaceId/invites/:inviteId/resend`,
  `DELETE /workspaces/:workspaceId/invites/:inviteId`. A new `WorkspaceInvitesController` in `InvitesModule`.
- **Rationale:** the permission is a workspace permission, so the workspace id has to be in the URL. Revoke is a
  `DELETE` returning 204 (nestjs.md), even though the row is kept with `status = 'revoked'`. Resend is an action
  that creates nothing, so it is a `POST` with 200.
- **Alternatives:** `/invites/:inviteId/resend` without the workspace. Rejected because the service would then
  have to load the invite first to find the workspace, and the invitee's routes already use that prefix.

## R2. Who may manage invites

- **Decision:** a pure function `canManageWorkspaceInvites({ workspaceRole })` in `permissions/board-access.ts`,
  true only for `admin`, with a table test. Each endpoint loads the workspace with `visibleWorkspaceWhere(userId)`
  plus the caller's `workspace_members.role`:
  - not visible, archived or unknown: **404 `WORKSPACE_NOT_FOUND`**;
  - visible, caller not admin (workspace member or board-only member): **403 `INVITE_MANAGE_FORBIDDEN`**.
- **Rationale:** spec Clarifications Q4 (admins only) and the house pattern of `createBoard` (specs/23 R2).
- **Alternatives:** reuse `canCreateBoard`. Rejected because it is a different rule that happens to have the same
  answer today; a named rule keeps the permission table readable.

## R3. Create: duplicates and members

- **Decision:**
  1. DTO: `email` trimmed and lower-cased (DB CHECK `email = lower(trim(email))`), `IsEmail`, `MaxLength(254)`;
     `role` optional, `IsIn(['admin', 'member'])`, default `member`.
  2. If a `workspace_members` row of that workspace has a user with that email: **409 `ALREADY_MEMBER`**.
  3. Insert the invite in a `DB.batch` with its audit row. A pending invite for the same workspace and email
     (expired or not) makes the batch fail on `uq_invites_pending_target_nulls`: **409 `INVITE_PENDING`**.
- **Rationale:** spec Clarifications Q1. The unique index decides the duplicate, so two parallel requests cannot
  both succeed (database.md: no pre-check read for unique keys). The member check is a read, but the only race is
  someone accepting another invite at the same moment, which cannot happen because that invite would be the
  pending one.
- **Detecting the conflict:** the batch runs raw D1 statements, so Prisma's P2002 is not available. Catch the D1
  error whose message contains `UNIQUE constraint failed` and map it to 409; rethrow anything else. One small
  helper next to `isUniqueConflict` in `src/database/prisma-errors.ts`, with a unit test.
- **Does 409 `ALREADY_MEMBER` leak account existence?** No. It only says that the address belongs to a member of
  this workspace, which an admin can already see on the Members page.
- **Alternatives:** `prisma.invite.create` then a separate audit insert. Rejected: not atomic.

## R4. Expiry and resend

- **Decision:** `INVITE_DAYS = 14`, `expiresAt = now + 14 × DAY_MS` on create and on resend. Resend is one
  `updateMany` on `{ id, workspaceId, boardId: null, status: 'pending', lastSentAt ≤ now − 60 s }` that sets
  `lastSentAt = now` and `expiresAt = now + 14 d`. When it updates 0 rows, read the invite once:
  - missing, not pending, or not a workspace invite of this workspace: **404 `INVITE_NOT_FOUND`**;
  - otherwise: **429 `RESEND_COOLDOWN`**, `details: { retryAfterSeconds }` (60 − seconds since `lastSentAt`,
    at least 1).
- **Rationale:** spec Clarifications Q2 and Q3, `docs/database/schema-design.md` ("Resend updates `last_sent_at`
  and `expires_at`"). The condition in the update makes two parallel resends send one email. `lastSentAt` is
  already on the row, so no `auth_throttles` row is needed.
- **Alternatives:** `SendCooldownService`. Rejected: it is keyed by auth scope and email, and the invite row
  already has the timestamp.

## R4b. Throttling create (after security review, confirmed by the user 2026-11-27)

- **Decision:** before inserting, `create` refuses with **429 `RESEND_COOLDOWN`** (`details.retryAfterSeconds`) when
  an answered or revoked invite to the same workspace and email has `lastSentAt` in the last 60 s, and with
  **429 `INVITE_RATE_LIMITED`** when the caller created 50 or more invites (any workspace, any status) in the last
  hour. A pending invite still answers 409 `INVITE_PENDING`.
- **Rationale:** both reviews found that revoke frees the unique index, so create → revoke → create sent unlimited
  email, with sender-chosen names, from our domain. The counts read existing columns, so no table or migration.
- **Limit:** read-then-write; two parallel requests can both pass once. Move to `auth_throttles` if abused.

## R5. Revoke

- **Decision:** one `updateMany` on `{ id, workspaceId, boardId: null, status: 'pending' }` setting
  `status = 'revoked'`; 0 rows → **404 `INVITE_NOT_FOUND`**. Response 204. `respondedAt`/`respondedById` stay
  NULL: they describe the invitee's answer.
- **Rationale:** accept already updates only `status = 'pending'` rows, so revoke and accept cannot both win.
  Revoking an expired invite is allowed (spec Business Rules).

## R6. Audit

- **Decision:** sending an invite writes one `audit_log_entries` row in the same batch: `workspace_id` = the
  workspace, `action = 'invite'`, `target_type = 'invite'`, `target_id` = the invite id, `target_label` = `''`,
  `data = {"role": "<role>"}`, actor name copied from `users`. Resend and revoke are not audited.
- **Rationale:** BRD §10 records "invites" among admin actions, and the `invite` action exists; workspace creation
  already writes its audit row the same way. security.md: audit rows are kept forever and must not hold other
  people's emails, so the email is not copied; the audit screen can join `invites` on `target_id`. The enum has no
  action for resend or revoke.
- **Confirmed** by the user on 2026-11-27.

## R7. Email

- **Decision:** `EmailService.sendWorkspaceInvite({ id: inviteId, email }, inviterName, workspaceName)`, sent after
  the batch resolves (and after a successful resend). Plain text: who invited you, to which workspace, valid for 14
  days, a link to `${APP_ORIGIN}/` to sign in or sign up with this address, where the invite is on Home.
- **Rationale:** invites are matched by email at sign-in (`visibleInviteWhere`), so the email carries no token.
  security.md's token rule applies to invites only if they carried one. `EmailRecipient.id` is only used in log
  lines; the invite id is used because the invitee may have no account. A failed send is only logged (existing
  behaviour); the admin can resend.
- **Personal data in the email:** the inviter's name and the workspace name, which the recipient needs in order
  to decide.

## R7b. Names in the email

- **Decision:** `sendWorkspaceInvite` collapses whitespace (line breaks included) in the inviter and workspace names
  and cuts each to 100 characters (security review H1: `fullName` has no length limit and keeps line breaks).

## R8. List

- **Decision:** `GET` returns the workspace's pending workspace invites (`boardId: null`, `status: 'pending'`),
  expired ones included, newest first by id, paginated with `?limit=&cursor=` (default 50, max 100) as
  `{ items, nextCursor }`. Each item: `id, email, role, expiresAt, lastSentAt, expired, invitedBy: { id, fullName }`.
  POST and resend return the same item shape.
- **Rationale:** nestjs.md pagination rule. `expired` is computed on the server (`expiresAt <= now`) so the client
  does not depend on its clock to show "Resend". Answered and revoked invites are not "pending" (AC 1.2, 2.1).

## R9. Out of scope

- Board invites (`boardId` set) and the workspace `outsideInviteRule`: share-board feature.
- In-app `invite` notifications: not on the card; Home already lists pending invites.
- Inviting several emails in one request: the card says "enter email".

## R10. Existing pieces reused

`visibleWorkspaceWhere`, `uuidParam`, `uuidv7`, `sqlDate`, `DAY_MS`, `getBindings().DB.batch`, `EmailService`,
the `AllExceptionsFilter` envelope with `details`, and the e2e helpers in `test/home.e2e-spec.ts`
(`signedIn`, `makeWorkspace`).
