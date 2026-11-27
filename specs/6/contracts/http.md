# Contracts: #6 Home — Workspaces, Boards and Invites

All routes are under `/api/v1`, need a session (401 without one), and writes need the CSRF cookie + header (403
`CSRF_INVALID`). Errors use the global envelope `{ error: { code, message, details } }`. Path ids are UUIDs
(`ParseUUIDPipe` → 400 `VALIDATION_FAILED`).

## Shared shapes

```ts
type BoardTile = {
  id: string; name: string;
  workspaceId: string; workspaceName: string;
  visibility: 'private' | 'workspace';
  backgroundKey: string | null;   // preset id from board_backgrounds, or null
  backgroundThumbnailUrl: string | null; // GET it for the tile image; null → show backgroundColor
  backgroundColor: string;        // one of the 10 preset hex colors, e.g. "#0d9488"; always set
  starred: boolean;
};

type WorkspaceTile = {
  id: string; name: string;
  role: 'admin' | 'member' | null; // null = board-only member
  boardCount: number;              // boards the viewer can access (Q5)
  memberCount: number | null;      // workspace_members; null for a board-only viewer (research D4)
  boards: BoardTile[];             // accessible open boards, by name
};

type PendingInvite = {
  id: string;
  type: 'workspace' | 'board';
  workspace: { id: string; name: string };
  board: { id: string; name: string } | null;
  role: 'admin' | 'member';
  invitedBy: { fullName: string };
  expiresAt: string;               // ISO 8601 UTC
  expired: boolean;                // true → Accept disabled, Decline allowed
};
```

## `GET /home`

200:
```json
{ "starred": [BoardTile], "recent": [BoardTile], "workspaces": [WorkspaceTile], "invites": [PendingInvite], "hasArchivedWorkspaces": boolean }
```
- `hasArchivedWorkspaces`: the caller is workspace admin of ≥ 1 archived workspace → the client shows
  `View archived workspaces` (→ WEB-20, UI decision #372). The list itself is the archive/restore ticket.
- `starred`: in starred order (oldest star first). `recent`: ≤ 6, newest view first, starred boards included (`starred: true` on their tile).
- `workspaces`: by name; `[]` → the client shows the empty state (AC 5).
- `invites`: pending invites for the caller's email, newest first, including expired ones; none for archived
  workspaces or closed boards.
- Closed boards and archived workspaces never appear (Q3).

## `POST /workspaces`

Body: `{ "name": string }` (trimmed, 1–100 characters). 201: `WorkspaceTile` with `role: "admin"`, `boardCount: 0`,
`memberCount: 1`, `boards: []`.
400 `VALIDATION_FAILED` (missing, empty after trim, over 100 characters, unknown field).

## `GET /workspaces/:workspaceId`

200: `WorkspaceTile` (AC 6.1: all boards the caller can access). 404 `WORKSPACE_NOT_FOUND` when archived, unknown,
or the caller is neither a member nor on any of its boards.

## `PUT /boards/:boardId/star`

204, idempotent. 404 `BOARD_NOT_FOUND` when the caller cannot access the board (or it is closed / its workspace archived).

## `DELETE /boards/:boardId/star`

204, idempotent (also when not starred or no longer accessible).

## `POST /boards/:boardId/views`

204. Sets the caller's `last_viewed_at` for the board to now. 404 `BOARD_NOT_FOUND` as for star.
Called by the client when it opens a board (AC 6.2).

## `GET /board-backgrounds/:key/thumbnail`

200: the preset thumbnail image (`Content-Type` from R2, `Cache-Control: private, max-age=86400`). Any signed-in
user: presets are system images, not user content. 404 `BACKGROUND_NOT_FOUND` for an unknown key; 401 without a session.
Uploaded backgrounds are not served here (upload-background ticket); their tiles get `backgroundThumbnailUrl: null`.

## `POST /invites/:inviteId/accept`

200: `{ "workspaceId": string, "boardId": string | null }` (where the client navigates next).
- 404 `INVITE_NOT_FOUND`: unknown, not for the caller's email, not pending, workspace archived, or board closed.
- 409 `INVITE_EXPIRED`: pending but past `expiresAt`.
- Workspace invite: caller becomes a workspace member with the invite's role; their board memberships stay; their
  other live pending board invites in that workspace are accepted too.
- Board invite: caller becomes a board member with the invite's role (board-only unless already in the workspace).
- Two concurrent accepts: one 200, the other 404; one membership row.

## `POST /invites/:inviteId/decline`

204. Works for expired invites. 404 `INVITE_NOT_FOUND` as for accept (except expiry).
