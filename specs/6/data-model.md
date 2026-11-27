# Data model: #6 Home — Workspaces, Boards and Invites

One migration, `prisma/migrations/0002_board_background_color.sql` (card update, decisions #375–#377): adds
`boards.background_color TEXT NOT NULL DEFAULT '#0d9488'` with CHECK `boards_background_color_check` (10 preset hexes)
and backfills existing boards with a random preset color. Every other table exists in `0001_init.sql`.

| Table | Read | Written by | Notes |
|---|---|---|---|
| `workspaces` | Home, workspace page | `POST /workspaces` | `archived_at IS NOT NULL` → hidden everywhere (Q3). `name` CHECK `trim(name) <> ''` |
| `workspace_members` | role, member count, access | create workspace (admin), accept workspace invite | `UNIQUE (workspace_id, user_id)`. No row = board-only member or outsider |
| `boards` | tiles, access | — | `closed_at IS NOT NULL` → hidden (Q3). `visibility`: `private` / `workspace` |
| `board_members` | access | accept board invite, auto-accept on joining workspace | `UNIQUE (board_id, user_id)` |
| `board_stars` | Starred | star / unstar | `UNIQUE (user_id, board_id)` |
| `board_views` | Recently viewed | record view | `UNIQUE (user_id, board_id)`; `last_viewed_at` upserted; index `idx_board_views_user_recent` |
| `invites` | Home pending list | accept / decline | see state machine below; matched on `email` (lower case) |
| `audit_log_entries` | — | create workspace | `action = 'workspace_created'` |
| `users` | sender name, actor name | — | |

## Derived values (not stored)

- **Can see board** (`permissions/board-access.ts`): workspace admin, or board member, or workspace member and
  `visibility = 'workspace'`; plus board open and workspace not archived (D1).
- **Workspace on Home**: not archived and (workspace member or can see ≥ 1 board in it).
- **role** on a tile: `workspace_members.role`, or `null` for board-only.
- **boardCount**: visible open boards in that workspace. **memberCount**: `workspace_members` rows; `null` for a
  board-only viewer (D4).
- **expired**: `status = 'pending' AND expires_at <= now`.

## Invite state machine (this ticket's part)

```
pending ──accept (not expired, email matches)──▶ accepted
pending ──decline (expired or not)────────────▶ declined
pending ──(revoke: sender ticket)─────────────▶ revoked
```

Accepted, declined and revoked are final; they no longer appear on Home and return 404 on accept/decline.

## Writes per action

| Action | Rows |
|---|---|
| Create workspace | +1 `workspaces`, +1 `workspace_members` (admin), +1 `audit_log_entries` — one `DB.batch` |
| Accept workspace invite | invite → accepted; +1 `workspace_members` (invite role); for each other live pending board invite of that email in the workspace: +1 `board_members`, invite → accepted — one `DB.batch` |
| Accept board invite | invite → accepted; +1 `board_members` (invite role) — one `DB.batch` |
| Decline | invite → declined |
| Star / unstar | +1 / −1 `board_stars` |
| Record view | upsert `board_views.last_viewed_at` |
