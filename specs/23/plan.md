# Implementation Plan: #23 Implement feature Create Board

**Branch**: `feat/23-implement-feature-create-board` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/23/spec.md`

## Summary

A workspace admin creates a board in their workspace with a name and a visibility (`Workspace` by default, or
`Private`). The backend adds `POST /workspaces/:workspaceId/boards`. One atomic `DB.batch` writes the board (with a
random preset color), the creator as board `admin`, the 6 default empty-name labels and a `board_created` activity.
It writes no lists. The response is the existing `BoardTile`. Workspace members get access through visibility
rules that already exist (spec Clarifications), so no row is written per member. The dialog behaviour (spinner,
field lock, `Esc`, tooltips) and opening the board are frontend work. See [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (tooling); runtime Cloudflare Workers

**Primary Dependencies**: NestJS 11, class-validator / class-transformer, Prisma 7.10 (D1 adapter)

**Storage**: Cloudflare D1 (SQLite). No schema change, no migration ([data-model.md](data-model.md)).

**Testing**: Jest: `pnpm test` (unit, permission table), `pnpm test:e2e` (local D1 in `.wrangler/e2e`)

**Target Platform**: Cloudflare Workers (`wrangler dev` locally)

**Project Type**: web-service (REST API, `/api/v1`)

**Performance Goals**: N/A (one read, one batch of 9 statements, one read-back per create)

**Constraints**: D1 atomic writes only through `DB.batch`; Workers have no Node-only APIs (`randomBoardColor`
already uses `node:crypto` `randomInt`, which is supported by the Workers nodejs_compat flag)

**Scale/Scope**: 1 endpoint, 1 DTO, 1 permission function, 1 service method, unit and e2e tests

## Constitution Check

`.specify/memory/constitution.md` is an unfilled template. The gates come from `AGENTS.md` and `.claude/rules/`.

| Gate | Status |
|---|---|
| Scope = the Trello card, nothing outside it | PASS. Frontend items are named as out of scope. The 6 default labels come from the BRD (§5) and the DB design, not added by us |
| Layers: module/controller/service/dto; Prisma or `DB.batch` directly | PASS |
| Auth is global; CSRF on writes; `@CurrentUser()` | PASS (no `@Public()`) |
| Permissions only in `src/modules/permissions/`, pure function plus table test | PASS (`canCreateBoard`) |
| 404 rather than 403 for content the caller may not see | PASS (404 for a workspace the caller cannot see; 403 only when it is visible) |
| IDs: server-generated UUIDv7; never taken from the client on create | PASS |
| Atomic writes through `DB.batch` | PASS |
| e2e for HTTP behaviour and DB writes | PASS |
| No new dependency, no migration | PASS |

Re-check after design: PASS, no violations. Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/23/
├── spec.md
├── plan.md              # this file
├── research.md          # R1 endpoint … R7 existing pieces
├── data-model.md        # rows written; no schema change
├── quickstart.md
└── contracts/
    └── boards.md        # POST /workspaces/:workspaceId/boards
```

### Source Code (repository root)

```text
src/modules/permissions/
├── board-access.ts                 # + canCreateBoard
└── board-access.spec.ts            # + canCreateBoard table
src/modules/workspaces/
├── dto/create-board.dto.ts         # new: name (trim, not empty), visibility (optional enum)
├── workspaces.controller.ts        # + POST :workspaceId/boards
└── workspaces.service.ts           # + createBoard: access check, DB.batch, read back BoardTile
test/
└── home.e2e-spec.ts                # + "create board" describe
```

**Structure Decision**: the route goes in the existing `workspaces` module because it has the `workspaces/` URL
prefix. It reuses `randomBoardColor` (`boards/board-colors.ts`) and `boardTileSelect`/`toBoardTile`
(`home/tiles.ts`). No new module.

## PO decisions (confirmed 2026-11-27)

- **Name length**: the PO kept "no maximum" as the product rule, then the user approved a technical abuse bound of
  512 characters after the security review (research R4).
- **6 default labels** are created with every new board, from the BRD §5 and the DB design (research R5).

## Complexity Tracking

None.
