---
description: "Task list for #6 Home — Workspaces, Boards and Invites"
---

# Tasks: #6 Implement feature Home — Workspaces, Boards and Invites

**Input**: `specs/6/` (spec.md, plan.md, research.md, data-model.md, contracts/http.md, quickstart.md)

**Tests**: required by `.claude/rules/testing.md` (every new endpoint: happy path, 401, 404, 400; invites: a
`Promise.all` race test). All e2e cases live in one file, `test/home.e2e-spec.ts`, one `describe` per story, so
test tasks in different stories are not parallel with each other.

The card's acceptance criteria are grouped into four stories:

- **US1 (P1)**: create a workspace; empty Home (AC 1, AC 5).
- **US2 (P1)**: workspace and board lists, open a workspace (AC 4, AC 6.1), incl. `hasArchivedWorkspaces`.
- **US3 (P2)**: accept / decline workspace and board invites (AC 3, AC 7).
- **US4 (P2)**: starred and recently viewed, star/unstar, record a view (AC 2, AC 6.2).

Rules every task follows (from research.md and the repo rules):
- "Can see board" = `visibleBoardWhere(userId)` only (research D1); never inline role checks.
- Hidden or missing → 404 with the feature code (`BOARD_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, `INVITE_NOT_FOUND`).
- Closed boards (`closedAt`) and archived workspaces (`archivedAt`) never appear (Q3).
- Atomic writes via `getBindings().DB.batch([...])` with `prepare().bind()`; ids `uuidv7()`, dates `sqlDate()`
  from `src/common/audit-log.ts`. Never interpolate request values into SQL.
- Explicit Prisma `select`; responses match contracts/http.md exactly.
- Controllers thin, `@ApiTags`, `@ApiResponse` for non-obvious codes, `ParseUUIDPipe` on path ids.

## Phase 1: Setup

- [X] T001 Create empty modules and register them in src/app.module.ts `imports`: src/modules/home/home.module.ts, src/modules/workspaces/workspaces.module.ts, src/modules/boards/boards.module.ts, src/modules/invites/invites.module.ts (each with its controller + service class, no routes yet; no module imports another's service)

## Phase 2: Foundational (blocks all stories)

- [X] T002 Add `visibleBoardWhere(userId: string): Prisma.BoardWhereInput` to src/modules/permissions/board-access.ts returning `{ closedAt: null, workspace: { archivedAt: null }, OR: [ { boardMembers: { some: { userId } } }, { workspace: { workspaceMembers: { some: { userId, role: 'admin' } } } }, { visibility: 'workspace', workspace: { workspaceMembers: { some: { userId } } } } ] }` with a one-line JSDoc saying it mirrors `canViewBoard` plus the closed/archived rule (research D1). `canViewBoard` and its table test stay unchanged.
- [X] T003 Create src/modules/home/tiles.ts exporting: `boardTileSelect(userId)` (Prisma `BoardSelect`: `id, name, workspaceId, visibility, backgroundKey, workspace: { select: { name } }, boardStars: { where: { userId }, select: { id } }`), `toBoardTile(row)` → `{ id, name, workspaceId, workspaceName, visibility, backgroundKey, starred }`, and `workspaceTileSelect(userId)` (`id, name, workspaceMembers: { where: { userId }, select: { role } }, _count: { select: { workspaceMembers: true } }, boards: { where: visibleBoardWhere(userId), orderBy: { name: 'asc' }, select: boardTileSelect(userId) }`) with `toWorkspaceTile(row)` → `{ id, name, role, boardCount: boards.length, memberCount: role === null ? null : _count.workspaceMembers, boards }` (contracts `BoardTile` / `WorkspaceTile`, research D4: `memberCount` null for a board-only viewer). Plain functions, imported by home and workspaces.
- [X] T004 Create test/home.e2e-spec.ts skeleton: app built like test/app.e2e-spec.ts (`Test.createTestingModule({ imports: [AppModule] })`, `setupApp`, `app.init`), `csrf` cookie + header constants, `signedIn()` returning `{ user, cookie }` with emails under `@home.e2e.test`, fixture helpers using `PrismaService`: `makeWorkspace(ownerId, { archived? })` (also adds owner as admin member), `makeBoard(workspaceId, creatorId, { visibility?, closed? })`, `addWorkspaceMember(workspaceId, userId, role)`, `addBoardMember(boardId, userId, role)`, `makeInvite({ workspaceId, boardId?, email, invitedById, role?, expiresAt? })` (default expiresAt = now + 14 days). Cleanup in `beforeEach` and `afterAll`, in FK order: `auditLogEntry` by actor in test users → `invite` where email ends with `@home.e2e.test` or invitedBy a test user → `workspace` created by test users (cascades members, boards, stars, views) → `user`.
- [X] T005 Implement `GET /home` in src/modules/home/home.controller.ts + home.service.ts returning `{ starred: [], recent: [], workspaces: [], invites: [], hasArchivedWorkspaces: false }` for now (each story fills its part); e2e in test/home.e2e-spec.ts: 401 without session.

**Checkpoint**: `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass.

## Phase 3: User Story 1 — create workspace, empty Home (P1) 🎯 MVP

**Goal**: a new user sees an empty Home and can create a workspace in which they are admin.

**Independent test**: quickstart scenarios 1, 2, 3.

### Tests

- [X] T006 [US1] In test/home.e2e-spec.ts `describe('US1 create workspace')`: new user `GET /home` → 200, all arrays empty, `hasArchivedWorkspaces: false`; `POST /workspaces { name: '  Team  ' }` → 201 body `{ name: 'Team', role: 'admin', boardCount: 0, memberCount: 1, boards: [] }` and an id; DB has one `workspace_members` row role `admin` and one `audit_log_entries` row `action: 'workspace_created'`, `workspaceId` = new id, `targetType: 'workspace'`; it then appears in `GET /home` `workspaces`; `{ name: '   ' }`, missing name, unknown field → 400 `VALIDATION_FAILED`; no CSRF header → 403 `CSRF_INVALID`; no session → 401.

### Implementation

- [X] T007 [P] [US1] Create src/modules/workspaces/dto/create-workspace.dto.ts: `name` with `@Transform` trim (as `UpdateProfileDto`), `@IsString()`, `@IsNotEmpty()`; DB rule quoted: `workspaces_name_check CHECK (trim(name) <> '')`; no max length (research D6).
- [X] T008 [US1] `WorkspacesService.create(user, name)` in src/modules/workspaces/workspaces.service.ts: one `DB.batch` of three statements with `id = uuidv7()`, `now = sqlDate(new Date())`: `INSERT INTO workspaces (id, name, created_by_id, created_at, updated_at)`; `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)` with role `'admin'`; `INSERT INTO audit_log_entries (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at) SELECT ?, ?, u.id, u.full_name, 'workspace_created', 'workspace', ?, ?, '{}', ?, ? FROM users u WHERE u.id = ?` (research D6). Return the `WorkspaceTile` from contracts (`role: 'admin', boardCount: 0, memberCount: 1, boards: []`).
- [X] T009 [US1] `POST /workspaces` in src/modules/workspaces/workspaces.controller.ts (`@ApiTags('workspaces')`, 201, `@ApiResponse` 400).

**Checkpoint**: T006 passes.

## Phase 4: User Story 2 — workspace and board lists, open a workspace (P1)

**Goal**: Home lists each workspace with its accessible boards and counts; opening a workspace shows its accessible boards.

**Independent test**: quickstart scenarios 4, 5, 6, 20, 22.

### Tests

- [X] T010 [US2] In test/home.e2e-spec.ts `describe('US2 lists')`: member of W1 (2 boards) and W2 → each tile has name, `boardCount`, `memberCount`, sorted by name; workspace member sees a `workspace` board but not a `private` board they are not on, the admin sees both; board-only member of one private board → W with `role: null`, `memberCount: null`, only that board; closed board not listed and not counted; archived workspace not listed; `hasArchivedWorkspaces` true for admin of an archived workspace, false for a member of one; `GET /workspaces/:id` → 200 tile for a member, 200 with only own boards for a board-only member, 404 `WORKSPACE_NOT_FOUND` for an outsider, an archived workspace and an unknown id, 400 `VALIDATION_FAILED` for a non-UUID, 401 without session.

### Implementation

- [X] T011 [US2] In src/modules/home/home.service.ts fill `workspaces`: `workspace.findMany({ where: { archivedAt: null, OR: [ { workspaceMembers: { some: { userId } } }, { boards: { some: visibleBoardWhere(userId) } } ] }, orderBy: { name: 'asc' }, select: workspaceTileSelect(userId) })` mapped with `toWorkspaceTile`; and `hasArchivedWorkspaces` = `workspaceMember.count({ where: { userId, role: 'admin', workspace: { archivedAt: { not: null } } } }) > 0` (research D2, D4).
- [X] T012 [US2] `WorkspacesService.findOne(userId, workspaceId)` + `GET /workspaces/:workspaceId` (`ParseUUIDPipe`) in src/modules/workspaces/: same `where` as T011 plus `id`, `findFirst` with `workspaceTileSelect`; null → `NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' })`.

**Checkpoint**: T010 passes.

## Phase 5: User Story 3 — accept / decline invites (P2)

**Goal**: pending workspace and board invites for the user's email appear on Home and can be accepted or declined; expired ones only declined.

**Independent test**: quickstart scenarios 12–19.

### Tests

- [X] T013 [US3] In test/home.e2e-spec.ts `describe('US3 invites')`: workspace invite to my email shows in `GET /home` `invites` with `type: 'workspace'`, workspace name, `invitedBy.fullName`, `role`, `expired: false`; invites newest first; invites of archived workspaces / closed boards / other emails / non-pending not listed; accept → 200 `{ workspaceId, boardId: null }`, `workspace_members` row with the invite role, invite `status: 'accepted'`, `respondedById` = me, W now in `workspaces`, invite gone; board-only member of B in W with a pending workspace invite and a pending (non-expired) board invite to B2 in W → accept workspace invite → still on B with the same role, now on B2, both invites accepted; an expired board invite in that case stays pending; board invite → `type: 'board'` with board and workspace names, accept → 200 `{ workspaceId, boardId }`, `board_members` row, no `workspace_members` row; decline → 204, `status: 'declined'`, gone from Home; expired invite → `expired: true`, accept 409 `INVITE_EXPIRED`, decline 204; another user's invite, an already declined invite, unknown id → 404 `INVITE_NOT_FOUND` on accept and decline; non-UUID → 400; no session → 401; two accepts with `Promise.all` → statuses `[200, 404]` in some order and exactly one membership row.

### Implementation

- [X] T014 [US3] In src/modules/home/home.service.ts fill `invites`: `invite.findMany({ where: { email: user.email, status: 'pending', workspace: { archivedAt: null }, OR: [ { boardId: null }, { board: { closedAt: null } } ] }, orderBy: { createdAt: 'desc' }, select: { id, boardId, role, expiresAt, workspace: { select: { id, name } }, board: { select: { id, name } }, invitedBy: { select: { fullName } } } })` mapped to `PendingInvite` (`type` from `boardId`, `expired = expiresAt <= now`, `expiresAt` ISO string). Only the sender's `fullName` is returned (security.md: minimise personal data).
- [X] T015 [US3] `InvitesService.accept(user, inviteId)` in src/modules/invites/invites.service.ts (research D7): load the invite with the same visibility filter as T014 plus `id` (`findFirst`, select `id, workspaceId, boardId, role, expiresAt`); none → 404 `INVITE_NOT_FOUND`; `expiresAt <= now` → 409 `INVITE_EXPIRED`. Then one `DB.batch`: (1) `UPDATE invites SET status='accepted', responded_at=?now, responded_by_id=?user, updated_at=?now WHERE id=? AND status='pending' AND expires_at > ?now`; guard `G = EXISTS (SELECT 1 FROM invites WHERE id=? AND status='accepted' AND responded_by_id=? AND responded_at=?now)`. Workspace invite: (2) `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) SELECT ?, ?, ?, ?, ?now, ?now WHERE G ON CONFLICT (workspace_id, user_id) DO NOTHING`; (3) before the batch, read with Prisma the caller's other live pending board invites in that workspace (`where: { workspaceId, email: user.email, boardId: { not: null }, status: 'pending', expiresAt: { gt: now } }`, select `id, boardId, role`); for each add `INSERT INTO board_members (id, board_id, user_id, role, created_at, updated_at) SELECT ?uuidv7, ?boardId, ?user, ?role, ?now, ?now WHERE G ON CONFLICT (board_id, user_id) DO NOTHING` and `UPDATE invites SET status='accepted', responded_at=?now, responded_by_id=?user, updated_at=?now WHERE id=? AND status='pending' AND G` (each row needs its own `uuidv7()`, so one statement per invite). Board invite: (2') `INSERT INTO board_members … SELECT … WHERE G ON CONFLICT (board_id, user_id) DO NOTHING`. If `results[0].meta.changes === 0`: re-read the invite → expired → 409 `INVITE_EXPIRED`, else 404 `INVITE_NOT_FOUND`. Return `{ workspaceId, boardId }`.
- [X] T016 [US3] `InvitesService.decline(user, inviteId)`: `invite.updateMany({ where: { id, email: user.email, status: 'pending' }, data: { status: 'declined', respondedAt: now, respondedById: user.id } })`; `count === 0` → 404 `INVITE_NOT_FOUND`.
- [X] T017 [US3] src/modules/invites/invites.controller.ts (`@ApiTags('invites')`): `POST /invites/:inviteId/accept` (`@HttpCode(200)`, `@ApiResponse` 404, 409) and `POST /invites/:inviteId/decline` (`@HttpCode(204)`, `@ApiResponse` 404), `ParseUUIDPipe`.

**Checkpoint**: T013 passes, including the race case (proves the `G` guard in a D1 batch).

## Phase 6: User Story 4 — starred and recently viewed (P2)

**Goal**: starred boards first, then up to 6 recently viewed non-starred boards; the user can star/unstar and the client records views.

**Independent test**: quickstart scenarios 7, 8, 9, 10, 11.

### Tests

- [X] T018 [US4] In test/home.e2e-spec.ts `describe('US4 starred and recent')`: 2 starred + 8 viewed (2 of them starred) → `starred` = the 2 in star order, `recent` = 6 newest non-starred by `lastViewedAt`; `starred` flag true on starred tiles everywhere; after a board is closed, its workspace archived, or the user's membership removed → gone from `starred` and `recent`; `PUT /boards/:id/star` twice → 204, one row; `DELETE` twice → 204, no row; `POST /boards/:id/views` twice → 204, one row, `lastViewedAt` later the second time; star and view on a board I cannot see / a closed board / unknown id → 404 `BOARD_NOT_FOUND`; non-UUID → 400; no CSRF header → 403; no session → 401.

### Implementation

- [X] T019 [US4] In src/modules/home/home.service.ts fill `starred` (`boardStar.findMany({ where: { userId, board: visibleBoardWhere(userId) }, orderBy: { createdAt: 'asc' }, select: { board: { select: boardTileSelect(userId) } } })`) and `recent` (`boardView.findMany({ where: { userId, board: { AND: [visibleBoardWhere(userId), { boardStars: { none: { userId } } }] } }, orderBy: { lastViewedAt: 'desc' }, take: 6, select: { board: { select: boardTileSelect(userId) } } })`), both mapped with `toBoardTile` (research D3, Q4). Run the five Home queries with `Promise.all`.
- [X] T020 [US4] `BoardsService` in src/modules/boards/boards.service.ts (research D5): private `assertVisible(userId, boardId)` = `board.findFirst({ where: { id: boardId, ...visibleBoardWhere(userId) }, select: { id: true } })`, null → 404 `BOARD_NOT_FOUND`; `star` = assertVisible then `INSERT INTO board_stars (id, user_id, board_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, board_id) DO NOTHING`; `unstar` = `boardStar.deleteMany({ where: { userId, boardId } })`, no access check; `recordView` = assertVisible then `INSERT INTO board_views (id, user_id, board_id, last_viewed_at, created_at, updated_at) VALUES (…) ON CONFLICT (user_id, board_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at, updated_at = excluded.updated_at`.
- [X] T021 [US4] src/modules/boards/boards.controller.ts (`@ApiTags('boards')`): `PUT /boards/:boardId/star` (204), `DELETE /boards/:boardId/star` (204), `POST /boards/:boardId/views` (`@HttpCode(204)`), `ParseUUIDPipe`, `@ApiResponse` 404.

**Checkpoint**: T018 passes.

## Phase 7: Polish

- [X] T022 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:check`; fix until all exit 0
- [X] T023 Run the `code-reviewer` and `security-auditor` agents (new controllers, DTOs, Prisma queries, raw SQL, permission filter); fix Critical/High findings

## Dependencies

- T001 → T002 → T003 → T005; T004 after T001
- US1 (T006–T009), US2 (T010–T012), US3 (T013–T017), US4 (T018–T021) each need Phase 2 only
- US2 reuses `workspaceTileSelect` (T003), not US1 code; US1's created workspace is visible in Home only after T011 (T006's "appears in `GET /home`" assertion depends on T011: run US2 before closing US1, or move that one assertion to T010)
- All story test tasks edit test/home.e2e-spec.ts and all Home sections edit home.service.ts: do the stories one after another
- T022–T023 last

## Parallel example

After T002: T003 ∥ T004. In US1: T007 (DTO) ∥ T006 (test). Across stories, only service/controller files of different
modules are independent (e.g. T012 workspaces ∥ T020 boards ∥ T015 invites) if more than one person works.

## Implementation strategy

MVP = Phases 1–4 (create workspace and see it with its boards: Home is useful). Then US3 (invites, the highest-risk
writes) and US4. Phase 7 before `/create-pr`.
