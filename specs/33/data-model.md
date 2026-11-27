# Data Model: #33 Create Workspace

No schema change and no migration.

Rows written by `POST /workspaces` (unchanged, one `DB.batch`, see `prisma/schema/workspaces.prisma`):

| Table | Row |
|---|---|
| `workspaces` | `id` (UUIDv7, server), `name`, `created_by_id` = caller; rules default `workspace_admins` |
| `workspace_members` | caller, `role = 'admin'` |
| `audit_log_entries` | `action = 'workspace_created'`, `target_type = 'workspace'`, `target_label` = name |

## Validation of `name`

1. Must be a string.
2. Each run of `\r`/`\n`/U+0085/U+2028/U+2029 → one space (new, research R3), then trim.
3. Not empty (also DB `workspaces_name_check`), at most 100 characters (research R2).
4. Not unique: equal names are allowed.

Workspace visibility: no field (research R1).
