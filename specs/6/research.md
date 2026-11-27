# Research: #6 Home — Workspaces, Boards and Invites

Decisions taken while planning. Clarifications Q1–Q5 in `spec.md` are inputs, not repeated here. Sources: `spec.md`,
`../docs/brd/requirements.md` §2–§4 and §10, `../docs/database/schema-design.md`, `prisma/schema/*.prisma`.

## D1. "Who can see a board" lives once, in `permissions/`, as both a predicate and a Prisma filter

- **Decision:** add `visibleBoardWhere(userId)` to `src/modules/permissions/board-access.ts`, next to `canViewBoard`:
  ```ts
  { closedAt: null, workspace: { archivedAt: null }, OR: [
      { boardMembers: { some: { userId } } },
      { workspace: { workspaceMembers: { some: { userId, role: 'admin' } } } },
      { visibility: 'workspace', workspace: { workspaceMembers: { some: { userId } } } } ] }
  ```
  Every Home list, the workspace page, star and record-view use it, so a board that is closed, in an archived
  workspace, or no longer accessible disappears everywhere at once (AC 2.2, Q3).
- **Rationale:** `database.md` says to put the permission filter in the query; `AGENTS.md` says permission rules
  live only in `permissions/`. Keeping the filter beside `canViewBoard` keeps one place to change. The OR branches
  mirror `canViewBoard` row for row (the table test stays the readable spec; the e2e tests cover the filter).
- **Alternatives:** load all boards then filter with `canViewBoard` in code (loads hidden rows, against
  `database.md`); raw SQL (Prisma can express it).

## D2. One read endpoint for Home: `GET /home`

- **Decision:** `GET /home` returns `{ starred, recent, workspaces, invites, hasArchivedWorkspaces }` in one response,
  unpaginated. `hasArchivedWorkspaces` = `workspaceMember.count({ where: { userId, role: 'admin', workspace: { archivedAt: { not: null } } } }) > 0`
  (5th query), for the `View archived workspaces` link (UI WEB-03, decision #372).
- **Rationale:** the screen needs all four together; the size is bounded by the user's own memberships (like
  `GET /auth/sessions`, `nestjs.md` exception). Four Prisma queries, no N+1: boards are nested in the workspace
  query with `where: visibleBoardWhere(userId)`, member counts via `_count`.
- `shortcut: no pagination; add ?limit/cursor on workspaces if a user has hundreds of boards.`
- **Alternatives:** four list endpoints (more round trips for one screen, nothing reuses them yet).

## D3. Recently viewed and starred queries

- **Recent:** `boardView.findMany({ where: { userId, board: visibleBoardWhere(userId) }, orderBy: { lastViewedAt: 'desc' }, take: 6 })`
  — independent of stars (Q4, revised): a starred board stays in Recently viewed; served by `idx_board_views_user_recent`.
- **Starred:** `boardStar.findMany({ where: { userId, board: visibleBoardWhere(userId) }, orderBy: { createdAt: 'asc' } })`
  — the order the user starred them (Inferred; the card gives no order).
- **Workspace boards:** sorted by name; workspaces sorted by name (Inferred).

## D4. Workspace tile for a board-only member

- **Decision:** a workspace appears on Home if it is not archived and the user is a workspace member **or** can see
  at least one board in it. `role` is `admin | member | null` (null = board-only). `boardCount` = number of visible
  boards returned for it (Q5). `memberCount` = `_count.workspaceMembers` for workspace members, and **`null` for a
  board-only member**.
- **Rationale:** BRD §2: a board-only member "sees that workspace's name and that board, nothing else of it", so
  the member count is not shown to them. Q5 fixed what is counted; this decides who sees it.
- **Alternatives:** show the count to everyone (leaks workspace info to board-only members).

## D5. Star / unstar / record view: idempotent raw upserts

- **Star:** `PUT /boards/:boardId/star` → check access with `board.findFirst({ where: { id, ...visibleBoardWhere } })`
  (404 `BOARD_NOT_FOUND` otherwise), then `INSERT INTO board_stars … ON CONFLICT (user_id, board_id) DO NOTHING`. 204.
- **Unstar:** `DELETE /boards/:boardId/star` → `boardStar.deleteMany({ where: { userId, boardId } })`, 204 even if
  nothing was starred and without an access check (only the caller's own rows can be touched).
- **View:** `POST /boards/:boardId/views` → same access check, then
  `INSERT INTO board_views … ON CONFLICT (user_id, board_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at, updated_at = excluded.updated_at`. 204.
- **Rationale:** one statement each, no read-then-write race; ids from the existing `uuidv7()`, dates from
  `sqlDate()` (`src/common/audit-log.ts`). Prisma `upsert` is two queries on D1 and races to P2002.

## D6. Create workspace: one `DB.batch`

- **Decision:** `POST /workspaces { name }` writes in one batch: `workspaces` row, `workspace_members` row
  (`role = 'admin'`), and an `audit_log_entries` row (`action = 'workspace_created'`, `workspace_id` = new id,
  `target_type = 'workspace'`, `target_label` = name, actor name copied from `users`). Returns 201 with the new
  workspace tile.
- **Rationale:** the creator must never end up with a workspace and no admin (BRD §2: creator becomes admin). The
  `workspace_created` audit action already exists in the schema; the workspace audit log (later ticket) will show it.
  `auditStatement()` is user-targeted with `workspace_id NULL`, so the insert is written in the service, not by
  generalising that helper.
- **Name:** trimmed, 1–100 characters. Non-empty is `workspaces_name_check`; the max 100 was chosen by the user on
  2026-11-27 after the security audit (M1): the DB and BRD set no limit, but the name is copied into the permanent
  audit log and returned on every member's Home, so an unbounded name lets one user bloat D1.

## D7. Accept / decline invite

- **Visibility of an invite:** `status = 'pending'`, `email = SessionUser.email` (both stored lower case:
  `invites_email_check`, `EmailDto`), workspace not archived, board (if any) not closed. Anything else, including
  another user's invite, is 404 `INVITE_NOT_FOUND` (no leak). Expired = pending and `expires_at <= now`
  (schema-design: not stored as a status).
- **Accept** `POST /invites/:inviteId/accept` (200 `{ workspaceId, boardId }`):
  - Expired → 409 `INVITE_EXPIRED` (AC 3.4: Accept disabled, the server refuses too).
  - One `DB.batch`, guarded so a lost race writes nothing:
    1. `UPDATE invites SET status='accepted', responded_at=?now, responded_by_id=?user … WHERE id=? AND status='pending' AND expires_at > ?now`
    2. Workspace invite: `INSERT INTO workspace_members … SELECT … WHERE <accepted guard> ON CONFLICT (workspace_id, user_id) DO NOTHING`
       with the invite's role. Existing board memberships are kept (BRD §3: board-only member becomes workspace member, keeps board roles).
       Then, BRD §3 default: other **non-expired** pending board invites for the same email in that workspace are accepted
       too — for each, first mark the invite accepted (guarded by the main invite and `status='pending'`), then insert
       its `board_members` row guarded on **that board invite** being accepted by this request (`ON CONFLICT DO NOTHING`),
       so a concurrent decline/revoke of the board invite wins.
    3. Board invite: `INSERT INTO board_members … SELECT … WHERE <accepted guard> ON CONFLICT (board_id, user_id) DO NOTHING` with the invite's role.
  - `<accepted guard>` = `EXISTS (SELECT 1 FROM invites WHERE id=? AND status='accepted' AND responded_by_id=? AND responded_at=?now)`,
    stable across statements (unlike `changes()`, which only sees the previous statement).
  - If statement 1 changed 0 rows → re-read: expired → 409 `INVITE_EXPIRED`, otherwise 404 `INVITE_NOT_FOUND`.
- **Decline** `POST /invites/:inviteId/decline` (204): `invite.updateMany({ where: { id, email, status: 'pending' }, data: { status: 'declined', respondedAt, respondedById } })`;
  count 0 → 404. Works for expired invites (BRD §3, AC 3.4).
- **Not done here:** audit rows (BRD §10 audits admin actions; accepting is not one), notifications to the sender
  (not in the card), emails.

## D7b. Board tile background (decided by the user, 2026-11-27)

- **Decision:** each `BoardTile` carries `backgroundThumbnailUrl` = `/api/v1/board-backgrounds/<key>/thumbnail` when
  `background_key` is set, else `null`; the client paints a fixed default color for `null` (no DB change; the 10
  presets are images, `schema-design.md`). New route `GET /board-backgrounds/:key/thumbnail` (in `boards/`) reads
  `board_backgrounds.thumbnail_object_key` and returns the R2 object, for any signed-in user.
- **Rationale:** BRD §5 and UI WEB-03: the tile shows the board background; no route served R2 images yet.
- `shortcut:` uploaded backgrounds (`background_object_key`) return `null` until the upload ticket adds a
  board-permission-checked route (they are user content, unlike presets).
- **Extended by the card update (decisions #375–#377):** the default is no longer a client constant. New column
  `boards.background_color TEXT NOT NULL DEFAULT '#0d9488'` with CHECK `boards_background_color_check` (the 10 preset
  hexes from the UI palette `.bgc-1..10`), backfilled with a random preset color. Tiles return `backgroundColor`;
  the client shows the thumbnail if set, else that color.
  - **Migration 0002 is hand-written** (`ALTER TABLE … ADD COLUMN` + `UPDATE … CASE abs(random()) % 10`): `pnpm db:diff`
    proposed a full rebuild of `boards` that drops the manual CHECKs and `idx_boards_workspace_open` and risks FK
    cascades on D1. `pnpm db:check` reports no drift; a scratch SQLite run gave all 10 colors over 200 boards, no NULL.
  - **Hex, not a catalog table:** a catalog (like `label_colors`) would need its rows before the NOT NULL backfill,
    i.e. seed data inside the migration. The palette lives in `src/modules/boards/board-colors.ts` and the CHECK; a unit
    test keeps the two equal.
  - **Random at creation:** `randomBoardColor()` (`node:crypto` `randomInt`). There is no create-board endpoint yet
    (WEB-D01 card); it must call this helper. The DB default `#0d9488` is only for `ADD COLUMN` and raw inserts.

## D8. Module layout

- `src/modules/workspaces/` (create, get one), `src/modules/boards/` (star, view), `src/modules/invites/`
  (accept, decline), `src/modules/home/` (read model). Each controller is thin; no module imports another's service
  (shared logic is the `permissions/` filter only).

## Open questions (for the user)

1. **Archived workspaces for workspace admins — resolved 2026-11-27.** BRD §4: "Workspace admins still see [an
   archived workspace] and can restore it". Decision (user): Home hides archived workspaces for everyone (Q3 stands);
   admins find them on a **separate "Archived workspaces" list page**, like the closed boards list. That page and
   its API belong to the archive/restore ticket, not #6. The UI design (`../docs/ui-pipeline/screen_mapping.md`
   has no such screen; Home row 2 says "not shown to members") needs updating there.
2. **Re-accept after leaving / already a member.** Not reachable in this ticket (no leave/remove or send endpoints
   yet). `ON CONFLICT DO NOTHING` keeps accept safe and **keeps the existing role** (an `admin` invite does not
   promote an existing `member`). The send-invite ticket should refuse inviting someone who is already a workspace
   member (BRD §3: existing members are added directly), so this case should not arise.
