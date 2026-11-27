# Data model: #23 Create Board

**No schema change and no migration.** Every table, CHECK constraint and seed row below already exists.

| Table | Row written on create | Notes |
|---|---|---|
| `boards` | 1 | `name` (trimmed, CHECK `trim(name) <> ''`), `visibility` (`workspace` default, or `private`), `background_color` = random preset (CHECK lists the 10), `created_by_id` = caller, `next_card_number` 1, `closed_at` NULL |
| `board_members` | 1 | caller, `role = 'admin'`; unique `(board_id, user_id)` |
| `labels` | 6 | `name = ''`, `color_key` ∈ `green, yellow, orange, red, purple, blue` (FK to the `label_colors` seed) |
| `activities` | 1 | `type = 'board_created'`, `card_id` NULL (CHECK `activities_check`), `data = '{}'`, `actor_id` = caller |
| `lists` | 0 | the board starts empty, with no template columns |
| `audit_log_entries` | 0 | board creation is not an audited admin action (BRD §10) |

## Access (derived, not stored)

- Workspace admin: admin of every board (`canViewBoard`).
- Workspace member: sees `workspace` boards; sees `private` boards only with a `board_members` row.
- Board-only member: sees only the boards where they have a `board_members` row.

## Permission rule added

`canCreateBoard({ workspaceRole })` returns `workspaceRole === 'admin'`. It goes in
`src/modules/permissions/board-access.ts`, with a table test.
