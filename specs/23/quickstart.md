# Quickstart: #23 Create Board

## Prerequisites

Worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`).

## Automated check

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected:

- `src/modules/permissions/board-access.spec.ts`: the `canCreateBoard` table passes (admin → true; member,
  board-only, outsider → false).
- `test/home.e2e-spec.ts` › "create board" passes:

| Scenario | Expected |
|---|---|
| Admin posts `{ "name": "  Roadmap  " }` | 201, `name: "Roadmap"`, `visibility: "workspace"`, `backgroundColor` one of the 10 presets; DB: 1 board member (caller, admin), 6 labels with empty names, 1 `board_created` activity, 0 lists |
| Admin posts `{ "name": "Secret", "visibility": "private" }` | 201; `GET /home` shows it to the creator and to another workspace admin, not to a workspace member |
| Admin posts a `workspace` board | a workspace member sees it on `GET /workspaces/:id` |
| `{ "name": "   " }`, missing name, `visibility: "public"`, unknown field | 400 `VALIDATION_FAILED` |
| A 512-character name / a 513-character name | 201 / 400 `VALIDATION_FAILED` |
| Workspace member or board-only member posts | 403 `BOARD_CREATE_FORBIDDEN` |
| Outsider, archived workspace, unknown id | 404 `WORKSPACE_NOT_FOUND` |
| No CSRF header | 403 `CSRF_INVALID` |

## Manual check (optional)

`pnpm start:dev`, sign in as a workspace admin, then send
`POST http://localhost:8787/api/v1/workspaces/<id>/boards` with the session and CSRF cookies plus the CSRF header,
then `GET /api/v1/workspaces/<id>`: the new board is in `boards`. See [contracts/boards.md](contracts/boards.md).
