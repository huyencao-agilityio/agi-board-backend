# Research: #23 Create Board

Card rules that belong to the frontend (dialog, tooltips, spinner, field lock, `Esc`/outside click, opening the
board) are out of scope for the backend. This file covers the backend decisions only.

## R1. Endpoint shape

- **Decision:** `POST /api/v1/workspaces/:workspaceId/boards` with body `{ name, visibility? }`.
- **Rationale:** the board belongs to the workspace whose `Create new board` tile was clicked, and there is no
  workspace picker (spec Clarifications Q2). A nested route makes the workspace part of the URL, the same way
  `GET /workspaces/:workspaceId` reads it. The route lives in `WorkspacesController` because it has the
  `workspaces/` prefix.
- **Alternatives:** `POST /boards` with `workspaceId` in the body. Rejected because nothing else in the API puts the
  parent id in the body, and the `boards/:boardId` controller prefix does not fit a create.

## R2. Who may create

- **Decision:** add a pure function `canCreateBoard({ workspaceRole })` to `src/modules/permissions/board-access.ts`
  that is true only for `admin`, and add a table test for it. The service loads the workspace with
  `visibleWorkspaceWhere(userId)` plus the caller's `workspace_members.role`:
  - The workspace is unknown, archived or not visible to the caller: **404 `WORKSPACE_NOT_FOUND`**. This is the same
    message `GET /workspaces/:id` gives, so the API does not reveal that the workspace exists.
  - The workspace is visible but the caller is not its admin (a workspace member or a board-only member):
    **403 `BOARD_CREATE_FORBIDDEN`**. They can already see the workspace, so a 403 reveals nothing new.
- **Rationale:** BRD §2 says "Only the admin of a workspace can create boards". AGENTS.md requires every permission
  rule to live in `permissions/` as a pure function with a table test (R-02).
- **Alternatives:** 404 for non-admins too. Rejected because the caller can see the workspace, so 404 would be wrong
  and would confuse the frontend.

## R3. Board members and access

- **Decision:** write one `board_members` row, for the creator with role `admin`. Do not write a row for each
  workspace member.
- **Rationale:** spec Clarifications Q1 and Q3, BRD §2. Workspace members get access through visibility, and
  workspace admins through `canViewBoard`. Both work already.

## R4. Name validation

- **Decision:** trim the name in the DTO, then require `IsString`, `IsNotEmpty` and **`MaxLength(512)`**. The DB
  already has `boards_name_check CHECK (trim(name) <> '')`.
- **Update 2026-11-27 (security review M1, user decision):** the card says "no maximum length", but the only real cap
  was the 100 KB default JSON body limit. `GET /home` returns every visible board name without pagination, so a
  workspace admin could create many ~100 KB names and exhaust Worker memory for every member. 512 is a technical
  abuse bound, not a product limit: no real board name reaches it. The paragraphs below give the original
  reasoning.
- **Rationale:** the 100-character limit on workspaces exists only because the workspace name is copied into the
  permanent audit log (specs/6 D6). Creating a board writes no audit row (BRD §10 does not list it), and the
  `board_created` activity has `data = {}`, so nothing stores a copy of the name. The JSON body size limit is the
  only cap.
- **Alternatives:** a 100-character limit for consistency with workspaces. Rejected because the card says
  "no maximum length". This is open to the PO if they want a limit. (Line-break replacement is not in the card, so
  it is not added.)

## R5. Writes are atomic, and the board starts empty

- **Decision:** one `DB.batch` (D1 cannot run transactions through Prisma; AGENTS.md) inserts:
  1. `boards`: a new `uuidv7()` id, the workspace id, the name, the visibility (default `workspace`),
     `background_color = randomBoardColor()` (decision #376), and `created_by_id`;
  2. `board_members`: the creator as `admin`;
  3. six `labels` with empty names and the colors `green`, `yellow`, `orange`, `red`, `purple`, `blue`
     (BRD §5 "6 defaults per board"; `docs/database/schema-design.md` catalog row);
  4. `activities`: `board_created`, `card_id NULL`, `data '{}'` (schema-design "Board and list events").
- No `lists` rows: the card says "initially empty board without built-in template columns".
- **Rationale:** if any part is missing the result is a broken board (no admin, no labels), so everything goes in
  one atomic batch. This follows the pattern of `WorkspacesService.create`.
- **Alternatives:** create the labels lazily when they are first opened. Rejected because the BRD says the defaults
  belong to every board, and the label ticket expects the rows to exist.

## R6. Response

- **Decision:** `201` with the `BoardTile` shape (`toBoardTile`, specs/6 contracts), read back after the batch with
  `boardTileSelect`. The frontend opens `/boards/<id>`, and the same tile can be added to the Home list without a
  refetch.
- **Alternatives:** return `{ id }` only. Rejected because the tile shape already exists and saves the frontend one
  call.

## R7. What already exists (no change needed)

- `Board`, `BoardMember`, `Label` and `Activity` models, the CHECK constraints and the label color catalog (seed):
  **no migration**.
- `canViewBoard` / `visibleBoardWhere` already handle Private and Workspace visibility, so the new board appears in
  `GET /home` and `GET /workspaces/:id` for the right people.
- Opening the board (`GET /boards/:id`, the board view) is not part of this card.
