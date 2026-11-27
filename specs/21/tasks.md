---
description: "Task list for #21 Implement feature Invite to Workspace"
---

# Tasks: #21 Implement feature Invite to Workspace

**Input**: `specs/21/` (spec.md, plan.md, research.md, data-model.md, contracts/invites.md, quickstart.md)

**Tests**: required by `.claude/rules/testing.md`: a permission rule needs a table row per case; each new endpoint
needs e2e for the happy path, 401, 404, 400; concurrency-sensitive invite writes need a `Promise.all` test. All e2e
cases go in one new file `test/workspace-invites.e2e-spec.ts`, so the e2e tasks are not parallel with each other.

User stories (backend part of the card's Acceptance Criteria):

- **US1 (P1)**: a workspace admin sends an invite (email + role); it appears in the pending list (AC 1).
- **US2 (P2)**: a workspace admin resends or revokes a pending invite; resend resets the expiry to 14 days (AC 2).
- **US3 (P3)**: the invitee sees, accepts or declines the invite (AC 3, AC 4). **Already built in #6**
  (`src/modules/invites/invites.service.ts`, `GET /home`); only end-to-end tests through the new endpoints.
- The invite dialog, the Members page and the Home rows are **frontend only**.

Rules every task follows:

- Permission decisions only through `src/modules/permissions/board-access.ts` (no inline role checks).
- The acting user comes from `@CurrentUser()` only; ids generated with `uuidv7()`; map DTO fields explicitly.
- Never log, audit or put in a URL the invitee's email (security.md). The email travels only in the POST body,
  the `invites` row, the list response to admins, and the invite email itself.
- Error codes (contracts/invites.md): `WORKSPACE_NOT_FOUND` 404, `INVITE_MANAGE_FORBIDDEN` 403,
  `ALREADY_MEMBER` 409, `INVITE_PENDING` 409, `INVITE_NOT_FOUND` 404, `RESEND_COOLDOWN` 429 with
  `details: { retryAfterSeconds }`.
- Constants: `INVITE_DAYS = 14` (expiry, with `DAY_MS` from `src/common/session-cookie.ts`), `RESEND_COOLDOWN_SECONDS = 60`.
- User decisions (2026-11-27): only *sending* writes an audit row (`action = 'invite'`); the 429 code is `RESEND_COOLDOWN`.
- E2E assertions: status, `error.code` and response fields, never `message` text.

## Phase 1: Setup

No setup is needed: the worktree, dependencies and local D1 are ready. No schema change, no migration (data-model.md).

## Phase 2: Foundational (blocks US1 and US2)

- [X] T001 [P] In `src/modules/permissions/board-access.ts`, add the exported pure function `canManageWorkspaceInvites({ workspaceRole }: Pick<BoardAccessFacts, 'workspaceRole'>): boolean` returning `workspaceRole === 'admin'`, with a one-line JSDoc ("Only workspace admins send, list, resend and revoke workspace invites (spec #21 Clarifications Q4)"). In `src/modules/permissions/board-access.spec.ts`, add a `describe('canManageWorkspaceInvites')` `it.each` table: workspace admin → true; workspace member → false; board-only member (`workspaceRole: null`) → false; outsider (`null`) → false.
- [X] T002 [P] In `src/database/prisma-errors.ts`, add `export function isD1UniqueConflict(err: unknown): boolean` returning true when `err instanceof Error && err.message.includes('UNIQUE constraint failed')` (raw `DB.batch` statements do not raise Prisma's P2002; one-line comment saying so). Add `src/database/prisma-errors.spec.ts` (or extend it if present) with: an `Error('D1_ERROR: UNIQUE constraint failed: invites.workspace_id, ...')` → true; `new Error('other')` → false; a non-Error value → false.
- [X] T003 [P] In `src/modules/email/email.service.ts`, add `sendWorkspaceInvite(to: EmailRecipient, inviterName: string, workspaceName: string)` that calls the private `send()` with subject `` `${inviterName} invited you to ${workspaceName} on AGI Board` `` and a plain text body saying: who invited them, to which workspace, that the invite is valid for 14 days, and to sign in or sign up with this email address at `` `${this.appOrigin()}/` `` where the invite is on the Home page; "If you did not expect it, ignore this email." No token, no invite id in the text. In `src/modules/email/email.service.spec.ts`, add a case following the existing ones: the delivered text contains the inviter name, the workspace name and `APP_ORIGIN`, and is sent to `to.email`.
- [X] T004 Wire the module: in `src/modules/invites/invites.module.ts`, add `imports: [EmailModule]` (from `../email/email.module`) and register the new `WorkspaceInvitesController` (created empty in this task in `src/modules/invites/workspace-invites.controller.ts` with `@ApiTags('invites')` and `@Controller('workspaces/:workspaceId/invites')`). Inject `EmailService` into `InvitesService`'s constructor. In `InvitesService`, add a private helper `loadManagedWorkspace(user: SessionUser, workspaceId: string)` that does `prisma.workspace.findFirst({ where: { id: workspaceId, ...visibleWorkspaceWhere(user.id) }, select: { id: true, name: true, workspaceMembers: { where: { userId: user.id }, select: { role: true } } } })`; throws `NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' })` when null, and `ForbiddenException({ code: 'INVITE_MANAGE_FORBIDDEN', message: 'Only workspace admins can manage invites' })` when `!canManageWorkspaceInvites({ workspaceRole: ws.workspaceMembers[0]?.role ?? null })`; returns `{ id, name }`. Also add a shared `inviteItemSelect` (`id, email, role, expiresAt, lastSentAt, invitedBy: { select: { id: true, fullName: true } }`) and `toInviteItem(row, now)` adding `expired: row.expiresAt <= now`.
- [X] T005 Create `test/workspace-invites.e2e-spec.ts` with the scaffolding copied from `test/home.e2e-spec.ts` (same `beforeAll` with `Test.createTestingModule({ imports: [AppModule] })`, `setupApp`, `app.init()`): `DOMAIN = '@invites.e2e.test'`, `cleanup()` deleting `auditLogEntry` by actor, `invite` by email domain or inviter, workspaces by creator, users by domain (run in `beforeEach` and `afterAll`), and the helpers `signedIn()`, `get()`, `write()`, `home()`, `makeWorkspace()`, `makeBoard()`, `addWorkspaceMember()`, `addBoardMember()`, `makeInvite()` (with optional `status`, `expiresAt`, `lastSentAt`). Add a `describe('access')` with an `it.each` over the 4 routes (`POST /invites`, `GET /invites`, `POST /invites/:id/resend`, `DELETE /invites/:id`, using an existing invite id) asserting: no session → 401; outsider → 404 `WORKSPACE_NOT_FOUND`; archived workspace → 404 `WORKSPACE_NOT_FOUND`; workspace member and board-only member → 403 `INVITE_MANAGE_FORBIDDEN`; write without `X-CSRF-Token` → 403 `CSRF_INVALID`; non-UUID `workspaceId` / `inviteId` → 400 `VALIDATION_FAILED`.

**Checkpoint**: `pnpm test -- board-access prisma-errors email.service` passes.

## Phase 3: User Story 1 - Admin sends an invite and sees it pending (Priority: P1) 🎯 MVP

**Goal**: `POST /workspaces/:workspaceId/invites` creates a pending workspace invite (14-day expiry) with an audit
row and queues the invite email; `GET /workspaces/:workspaceId/invites` lists pending workspace invites.

**Independent Test**: an admin posts `{ "email": " New@Invites.E2E.test " }` → 201 `InviteItem` with
`email: "new@invites.e2e.test"`, `role: "member"`; the `GET` list then contains it.

### Tests for User Story 1

- [X] T006 [US1] In `test/workspace-invites.e2e-spec.ts`, add `describe('US1 send and list')`:
  - `it('creates a pending workspace invite, an audit row without the email, and lists it')`: admin posts `{ email: ' New@Invites.E2E.test ', role: 'admin' }` → 201 with `{ id, email: 'new@invites.e2e.test', role: 'admin', expired: false, invitedBy: { id: admin.id, fullName } }`, `expiresAt` within ±1 min of now + 14 days, `lastSentAt` ≈ now. DB: the invite has `boardId: null`, `status: 'pending'`, `invitedById: admin.id`. One `auditLogEntry` with `workspaceId: w.id`, `action: 'invite'`, `targetType: 'invite'`, `targetId: invite.id`, `targetLabel: ''`, `data` = `{"role":"admin"}`; assert no audit column contains the invitee email. `GET` list → `items` contains it, `nextCursor: null`.
  - `it('defaults role to member')`.
  - `it('409 INVITE_PENDING when a pending invite exists, expired or not')`: `makeInvite` valid → 409; another workspace with an expired pending invite (`expiresAt` in the past) → 409.
  - `it('allows a new invite after the old one was declined or revoked')` → 201.
  - `it('409 ALREADY_MEMBER for a workspace member address, including the admin\'s own')`.
  - `it('one of two parallel invites to the same address wins')`: `Promise.all` of 2 posts → statuses sorted `[201, 409]`, the 409 has `INVITE_PENDING`, and `invite.count` for that email and workspace is 1.
  - `it.each` 400 `VALIDATION_FAILED`: missing email, `'not-an-email'`, a 255-character address, `role: 'owner'`, unknown field `{ email, boardId }`.
  - `it('lists only pending workspace invites, newest first, with expired flagged and a cursor')`: seed one valid, one expired, one accepted, one revoked, one board invite (`makeBoard` + `boardId`) and one invite of another workspace → list returns only the valid and expired ones, newest first, the expired one with `expired: true`; `?limit=1` returns 1 item and a `nextCursor`, and `?limit=1&cursor=<it>` returns the other one with `nextCursor: null`; `?limit=0` and `?limit=101` → 400.

### Implementation for User Story 1

- [X] T007 [P] [US1] Create `src/modules/invites/dto/create-invite.dto.ts` with `export class CreateInviteDto`: `email` with `@Transform` (trim + `toLowerCase()` when a string, as in `src/modules/auth/dto/email.dto.ts`), `@IsEmail()`, `@MaxLength(254)` (DB CHECK `email = lower(trim(email))`); `role?` with `@IsOptional()` and `@IsIn(['admin', 'member'])` typed as `MemberRole` from `../../../generated/prisma/enums` (default `member` applied in the service). `@ApiProperty` / `@ApiPropertyOptional` with examples (`new.person@example.com`).
- [X] T008 [P] [US1] Create `src/modules/invites/dto/list-invites.dto.ts` with `export class ListInvitesDto`: `limit?` (`@IsOptional()`, `@Type(() => Number)`, `@IsInt()`, `@Min(1)`, `@Max(100)`, default 50 in the service) and `cursor?` (`@IsOptional()`, `@IsUUID()`). Follow any existing list DTO if one exists (`grep -r "cursor" src/modules/*/dto`).
- [X] T009 [US1] In `src/modules/invites/invites.service.ts`, add `create(user: SessionUser, workspaceId: string, dto: CreateInviteDto)`:
  1. `const ws = await this.loadManagedWorkspace(user, workspaceId)`.
  2. If `prisma.workspaceMember.count({ where: { workspaceId, user: { email: dto.email } } }) > 0` → `ConflictException({ code: 'ALREADY_MEMBER', message: 'This person is already a member of the workspace' })`.
  3. `id = uuidv7()`, `nowDate = new Date()`, `now = sqlDate(nowDate)`, `expires = sqlDate(new Date(nowDate.getTime() + INVITE_DAYS * DAY_MS))`, `role = dto.role ?? 'member'`. Run one `DB.batch`: `INSERT INTO invites (id, workspace_id, board_id, email, role, status, invited_by_id, last_sent_at, expires_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, 'pending', ?5, ?6, ?7, ?6, ?6)` and `INSERT INTO audit_log_entries (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at) SELECT ?1, ?2, u.id, u.full_name, 'invite', 'invite', ?3, '', ?4, ?5, ?5 FROM users u WHERE u.id = ?6` (bind a new `uuidv7()`, `workspaceId`, `id`, `JSON.stringify({ role })`, `now`, `user.id`), following `WorkspacesService.create`.
  4. Wrap the batch in `try/catch`: `isD1UniqueConflict(err)` → `ConflictException({ code: 'INVITE_PENDING', message: 'This email already has a pending invite' })`; rethrow anything else.
  5. After the batch: `this.email.sendWorkspaceInvite({ id, email: dto.email }, user.fullName, ws.name)`.
  6. Return `toInviteItem` of `prisma.invite.findUniqueOrThrow({ where: { id }, select: inviteItemSelect })`.
- [X] T010 [US1] In `src/modules/invites/invites.service.ts`, add `list(user, workspaceId, { limit = 50, cursor })`: `loadManagedWorkspace`, then `prisma.invite.findMany({ where: { workspaceId, boardId: null, status: 'pending', ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1, select: inviteItemSelect })`; return `{ items: rows.slice(0, limit).map(toInviteItem), nextCursor: rows.length > limit ? rows[limit - 1].id : null }`.
- [X] T011 [US1] In `src/modules/invites/workspace-invites.controller.ts`, add `@Post()` `create(@CurrentUser() user, @Param('workspaceId', uuidParam('workspaceId')) workspaceId, @Body() dto: CreateInviteDto)` and `@Get()` `list(..., @Query() query: ListInvitesDto)`, each calling the service, with `@ApiResponse` lines for 201/200, 400, 403 `INVITE_MANAGE_FORBIDDEN`, 404 `WORKSPACE_NOT_FOUND`, 409 `ALREADY_MEMBER` / `INVITE_PENDING`, following `src/modules/workspaces/workspaces.controller.ts`.

**Checkpoint**: T005 (POST/GET rows) and T006 pass (`pnpm test:e2e -- workspace-invites`).

## Phase 4: User Story 2 - Admin resends or revokes an invite (Priority: P2)

**Goal**: `POST …/:inviteId/resend` resets `expiresAt` to now + 14 days and `lastSentAt` to now and sends the email
again, at most once per 60 s; `DELETE …/:inviteId` sets `status = 'revoked'`.

**Independent Test**: an expired invite with `lastSentAt` 2 minutes ago → resend → 200 with `expired: false`; then
revoke → 204, and it is gone from the list.

### Tests for User Story 2

- [X] T012 [US2] In `test/workspace-invites.e2e-spec.ts`, add `describe('US2 resend and revoke')`:
  - `it('resend renews an expired invite')`: `makeInvite` with `expiresAt` 1 day ago and `lastSentAt` 2 minutes ago → 200 `InviteItem` with `expired: false`, `expiresAt` ≈ now + 14 d, `lastSentAt` ≈ now; DB row same id and role, still `pending`; no new audit row.
  - `it('resend renews a still-valid invite')` → 200.
  - `it('429 RESEND_COOLDOWN within 60 seconds')`: invite with `lastSentAt` 10 s ago → 429, `error.details.retryAfterSeconds` between 1 and 60 (≈ 50); `expiresAt` unchanged in DB.
  - `it('one of two parallel resends wins')`: `lastSentAt` 2 minutes ago, `Promise.all` of 2 resends → statuses sorted `[200, 429]`.
  - `it('revoke removes the invite from the list and from the invitee\'s Home')`: invitee is `signedIn()` with the invite's email → `home(invitee).invites` has it; revoke → 204; DB `status: 'revoked'`, `respondedAt: null`; the `GET` list no longer has it; `home(invitee).invites` is empty; invitee `POST /invites/:id/accept` → 404 `INVITE_NOT_FOUND`.
  - `it('revoke works on an expired invite')` → 204.
  - `it.each` 404 `INVITE_NOT_FOUND` for resend and revoke: unknown id, an accepted invite, a revoked invite, a board invite of this workspace, an invite of another workspace the caller also administers.

### Implementation for User Story 2

- [X] T013 [US2] In `src/modules/invites/invites.service.ts`, add `resend(user, workspaceId, inviteId)`:
  1. `const ws = await this.loadManagedWorkspace(user, workspaceId)`; `nowDate = new Date()`.
  2. `const target = { id: inviteId, workspaceId, boardId: null, status: 'pending' as const }`.
  3. `const { count } = await prisma.invite.updateMany({ where: { ...target, lastSentAt: { lte: new Date(nowDate.getTime() - RESEND_COOLDOWN_SECONDS * 1000) } }, data: { lastSentAt: nowDate, expiresAt: new Date(nowDate.getTime() + INVITE_DAYS * DAY_MS) } })` (the condition makes parallel resends send one email).
  4. If `count === 0`: `const row = await prisma.invite.findFirst({ where: target, select: { lastSentAt: true } })`; null → `NotFoundException({ code: 'INVITE_NOT_FOUND', message: 'Invite not found' })` (reuse the file's `inviteNotFound()`); else throw `new HttpException({ code: 'RESEND_COOLDOWN', message: 'Wait before resending this invite', details: { retryAfterSeconds } }, 429)` with `retryAfterSeconds = Math.max(1, Math.ceil(RESEND_COOLDOWN_SECONDS - (nowDate.getTime() - row.lastSentAt.getTime()) / 1000))`. Check that `AllExceptionsFilter` passes `details` through (it reads `obj.details`).
  5. Load the item with `findUniqueOrThrow({ where: { id: inviteId }, select: inviteItemSelect })`, then `this.email.sendWorkspaceInvite({ id: inviteId, email: item.email }, user.fullName, ws.name)`, return `toInviteItem(item, nowDate)`.
- [X] T014 [US2] In `src/modules/invites/invites.service.ts`, add `revoke(user, workspaceId, inviteId)`: `loadManagedWorkspace`, then `prisma.invite.updateMany({ where: { id: inviteId, workspaceId, boardId: null, status: 'pending' }, data: { status: 'revoked' } })`; `count === 0` → `inviteNotFound()`. No audit row (user decision).
- [X] T015 [US2] In `src/modules/invites/workspace-invites.controller.ts`, add `@Post(':inviteId/resend')` with `@HttpCode(200)` and `@Delete(':inviteId')` with `@HttpCode(204)`, both validating `workspaceId` and `inviteId` with `uuidParam(...)`, with `@ApiResponse` lines for 200/204, 403, 404 `WORKSPACE_NOT_FOUND` / `INVITE_NOT_FOUND`, and 429 `RESEND_COOLDOWN` (resend).

**Checkpoint**: T005 (all rows) and T012 pass.

## Phase 5: User Story 3 - Invitee accepts or declines (Priority: P3)

**Goal**: the invite sent through the new endpoint reaches the invitee's Home, and accept/decline (existing, #6)
work on it. No production code change expected.

**Independent Test**: admin invites `x@invites.e2e.test` as `admin`; a user with that email sees it on `GET /home`;
accept → workspace member with role `admin`.

- [X] T016 [US3] In `test/workspace-invites.e2e-spec.ts`, add `describe('US3 invitee')`:
  - `it('an invite sent by the admin appears on the invitee\'s Home and accept joins with the invited role')`: admin posts `{ email: invitee.email, role: 'admin' }`; `home(invitee).invites` contains `{ id, type: 'workspace', role: 'admin', expired: false }`; accept → 200 `{ workspaceId: w.id, boardId: null }`; `workspaceMember` role `admin`; the admin's `GET` list is empty.
  - `it('decline removes it from Home and lets the admin invite again')`: decline → 204; `home(invitee).invites` empty; admin posts the same email again → 201.
  - `it('a resent expired invite can be accepted')`: `makeInvite` expired with old `lastSentAt`; accept → 409 `INVITE_EXPIRED`; admin resends → 200; accept → 200.
- [X] T017 [US3] Run T016. If it fails, fix the US1/US2 code (row values written by `create`/`resend`), not `accept`/`decline`, unless a #6 rule is proven wrong.

**Checkpoint**: T016 passes.

## Phase 6: Polish & Cross-Cutting

- [X] T018 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` in the worktree and fix every failure. Report the real exit status (`.claude/rules/testing.md` › Reporting).
- [X] T019 Run the `code-reviewer` agent and the `security-auditor` agent (the change touches a controller, DTOs, a permission rule, raw D1 writes and personal data in emails; CLAUDE.md). Fix the Critical and High findings, then re-run T018.
- [X] T020 [P] Walk through `specs/21/quickstart.md`: every scenario in its table is covered by T001–T003, T005, T006, T012 or T016. Fix the quickstart or the tests if they disagree.

## Dependencies & Execution Order

- Phase 2: T001, T002, T003 touch different files and can run in parallel. T004 needs T001 and T003. T005 needs T004 (the controller exists).
- US1: T006 (failing tests) → T007, T008 in parallel → T009, T010 (service, need T002, T004, T007, T008) → T011.
- US2: needs US1 (tests create invites through the list/POST and reuse `loadManagedWorkspace`). T012 → T013, T014 → T015.
- US3: needs US1 and US2 (calls POST and resend). T016 → T017.
- Polish: T018 → T019. T020 any time after T016.

## Parallel Example

```text
# Phase 2, together:
T001 canManageWorkspaceInvites + table   (src/modules/permissions/)
T002 isD1UniqueConflict + unit test       (src/database/)
T003 sendWorkspaceInvite + unit test      (src/modules/email/)

# US1, together:
T007 CreateInviteDto                      (src/modules/invites/dto/create-invite.dto.ts)
T008 ListInvitesDto                       (src/modules/invites/dto/list-invites.dto.ts)
```

## Implementation Strategy

- **MVP = US1** (T001–T011): admins can invite and see pending invites; the existing Home accept/decline already
  completes the loop for the invitee.
- **US2** (T012–T015): resend and revoke.
- **US3** (T016–T017): end-to-end proof through the invitee's side; expected to pass without new code.
- Then Polish (T018–T020) and `/create-pr`.

## Review follow-up (T019, 2026-11-27)

- Security H1: names in the invite email collapsed to one line and capped at 100 characters (`email.service.ts`, unit test).
- Security H2 / code review M1: create throttled, 60 s per workspace and email plus 50 per hour per sender, as chosen by the user (research R4b, 2 e2e tests).
- Code review L1: resend re-reads the invite as pending before emailing, so a racing revoke sends nothing.
- Code review L2 (member check outside the batch): accepted as is; a leftover invite is harmless (`ON CONFLICT DO NOTHING`).
- Added the quickstart "resend right after create → 429" e2e case.
