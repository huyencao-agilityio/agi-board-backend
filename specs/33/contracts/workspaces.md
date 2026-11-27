# Contract: workspaces (delta for #33)

Base contract: `specs/6/contracts/` (`POST /workspaces`, `GET /workspaces/:workspaceId`). Only the change is listed.

## `POST /workspaces`

Body: `{ "name": string }`. Unknown fields → 400 (no `visibility` field, research R1).

- **Changed:** line breaks in `name` are replaced with a space before trimming and validation.
  `"Team\nAlpha"` is stored and returned as `"Team Alpha"`; `"\n\n"` → 400 `VALIDATION_FAILED`.
- Unchanged: 201 `WorkspaceTile` (`role: "admin"`, `boardCount: 0`, `memberCount: 1`, `boards: []`);
  400 `VALIDATION_FAILED` (missing, blank, over 100 characters, not a string, unknown field); 401 without a session;
  403 `CSRF_INVALID` without the CSRF header; the same name twice gives two workspaces with different ids.
