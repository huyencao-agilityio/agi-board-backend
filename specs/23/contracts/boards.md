# Contract: create board (#23)

Error envelope: `{ error: { code, message, details } }` (global filter). Session cookie and CSRF header required.

## `POST /api/v1/workspaces/:workspaceId/boards`

Body:

| Field | Type | Rule |
|---|---|---|
| `name` | string | Trimmed; 1–512 characters (512 is an abuse bound, research R4) |
| `visibility` | `"workspace"` \| `"private"` | Optional, default `"workspace"` |

Unknown fields → 400 (global whitelist).

### 201: `BoardTile` (same shape as specs/6 contracts)

```json
{
  "id": "0193…",
  "name": "Roadmap",
  "workspaceId": "0193…",
  "workspaceName": "Marketing",
  "visibility": "workspace",
  "backgroundKey": null,
  "backgroundThumbnailUrl": null,
  "backgroundColor": "#3b82d6",
  "starred": false
}
```

Side effects, all in one atomic batch (research R5):

- a `boards` row;
- a `board_members` row for the caller with role `admin`;
- 6 `labels` with empty names (`green`, `yellow`, `orange`, `red`, `purple`, `blue`);
- an `activities` row of type `board_created`;
- no `lists` rows.

### Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `name` missing, not a string, blank after trim or over 512 characters; `visibility` not one of the two values; unknown field; `workspaceId` not a UUID |
| 401 | — | no session |
| 403 | `CSRF_INVALID` | missing or wrong CSRF header |
| 403 | `BOARD_CREATE_FORBIDDEN` | workspace visible, but the caller is not its admin (a workspace member or a board-only member) |
| 404 | `WORKSPACE_NOT_FOUND` | workspace unknown, archived, or not visible to the caller |

## Effect on existing reads (no contract change)

`GET /home` and `GET /workspaces/:workspaceId` list the new board through `visibleBoardWhere`:

- a `workspace` board: every workspace member and admin;
- a `private` board: the creator and the workspace admins only.
