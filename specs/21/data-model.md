# Data model: #21 Invite to Workspace

**No schema change and no migration.** Every table, index, CHECK constraint and enum value below already exists.

## `invites` (workspace invite = `board_id IS NULL`)

| Column | Set by | Value |
|---|---|---|
| `id` | create | `uuidv7()` |
| `workspace_id` | create | from the URL |
| `board_id` | create | NULL |
| `email` | create | trimmed, lower case (CHECK `email = lower(trim(email))`) |
| `role` | create | `admin` or `member` (default `member`) |
| `status` | create / revoke / accept / decline | `pending` → `revoked` (this ticket), `accepted` / `declined` (#6) |
| `invited_by_id` | create | caller |
| `last_sent_at` | create, resend | now |
| `expires_at` | create, resend | now + 14 days |
| `responded_at`, `responded_by_id` | accept / decline only | unchanged by revoke |

**Uniqueness:** `uq_invites_pending_target_nulls` on `(workspace_id, ifnull(board_id, ''), email) WHERE status =
'pending'` allows one pending invite per workspace and email. An expired invite is still `pending`, so it blocks a
new one until it is resent, revoked, accepted or declined.

## State transitions

```text
            create
              │
              ▼
   ┌────── pending ──────┐  resend: same row, last_sent_at = now, expires_at = now + 14 d
   │   (expired when     │
   │  expires_at ≤ now)  │
   ▼          ▼          ▼
revoked   accepted*   declined*        * = existing (#6); accept is refused while expired
```

## `audit_log_entries` (one row per sent invite)

| Column | Value |
|---|---|
| `workspace_id` | the workspace |
| `actor_id`, `actor_name` | caller, name copied from `users` |
| `action` | `invite` |
| `target_type`, `target_id` | `invite`, the invite id |
| `target_label` | `''` (no copy of the invitee's email) |
| `data` | `{"role": "<role>"}` |

## Permission rule added

`canManageWorkspaceInvites({ workspaceRole })` returns `workspaceRole === 'admin'`, in
`src/modules/permissions/board-access.ts`, with a table test (admin → true; member, board-only (`null`) → false).
