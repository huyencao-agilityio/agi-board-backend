# Implementation Plan: #6 Implement feature Home — Workspaces, Boards and Invites

**Branch**: `feat/6-home-workspaces-boards-and-invites` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/6/spec.md`

## Summary

Backend for the Home screen. One read endpoint, `GET /home`, returns starred boards, the 6 most recently viewed
boards (starred or not), the user's workspaces with their accessible boards and counts, and pending invites for the
user's email. Writes: create workspace (workspace + admin membership + `workspace_created` audit row in one
`DB.batch`), star/unstar and record a board view (single-statement upserts), and accept/decline an invite (guarded
`DB.batch` so a lost race writes nothing). "Who can see a board" is one Prisma filter, `visibleBoardWhere`, next to
`canViewBoard` in `permissions/`, and it also hides closed boards and archived workspaces (Q3). No migration: all
tables exist. Invite create/send/resend/revoke are out of scope (Q1).

## Technical Context

**Language/Version**: TypeScript 5.9, NestJS 11, Prisma 7.10 (D1 adapter), Node 24 tooling

**Primary Dependencies**: existing only: `PrismaService`, D1 binding `DB` via `getBindings()`, `uuidv7()` and `sqlDate()` from `src/common/audit-log.ts`

**Storage**: D1, existing tables `workspaces`, `workspace_members`, `boards`, `board_members`, `board_stars`, `board_views`, `invites`, `audit_log_entries`, `users`; migration 0002 adds `boards.background_color` (hand-written ADD COLUMN + random backfill, research D7b)

**Testing**: Jest e2e against local D1 (`test/home.e2e-spec.ts`, 21 scenarios in quickstart.md); unit tests only for new pure logic

**Target Platform**: Cloudflare Workers

**Project Type**: web-service (REST API)

**Performance Goals**: `GET /home` = 5 Prisma queries, no N+1; each write = 1 statement or 1 batch

**Constraints**: atomic writes only via `DB.batch`; 404 (not 403) for hidden content; system roles grant nothing

**Scale/Scope**: 4 new modules (home, workspaces, boards, invites), 9 routes, 1 filter added to `permissions/`, ~21 e2e cases

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| The card is the scope | Pass: recipient-side invites only (Q1); star/view writes included (Q2) |
| Permission rules only in `permissions/`, table-tested | Pass: `visibleBoardWhere` beside `canViewBoard` (D1); `canViewBoard` unchanged |
| Permission filter in the list query | Pass: every list uses `visibleBoardWhere` (D1) |
| 404 for content the user may not see | Pass: `BOARD_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, `INVITE_NOT_FOUND` |
| Closed/archived rows filtered on normal reads | Pass: in the filter (Q3) |
| Atomic writes via `DB.batch`, not `$transaction` | Pass: create workspace (D6), accept (D7) |
| Ids UUIDv7; no client ids on create | Pass: Prisma default or `uuidv7()` in raw SQL |
| Raw SQL with bound values only | Pass: `prepare().bind()` |
| Lists paginated | Exception: `GET /home` is bounded by the user's memberships (D2), noted as a shortcut |
| Strings bounded | Workspace name: trimmed non-empty, no max (none in DB/BRD; same as `fullName`) (D6) |
| Concurrency-sensitive writes (invites) have a `Promise.all` e2e | Planned: scenario 19 |
| No new dependency | Pass |

Re-checked after Phase 1 design: unchanged. BRD §4 (admins still see archived workspaces) is met by a separate
"Archived workspaces" list page in the archive/restore ticket (research.md, Open questions #1, resolved).

## Project Structure

### Documentation (this feature)

```text
specs/6/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/http.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/modules/permissions/board-access.ts      # + visibleBoardWhere(userId)
src/modules/home/                             # home.module, home.controller (GET /home), home.service
src/modules/workspaces/                       # module, controller (POST /workspaces, GET /workspaces/:id), service, dto/create-workspace.dto.ts
src/modules/boards/                           # module, controller (PUT|DELETE /boards/:id/star, POST /boards/:id/views), service
src/modules/invites/                          # module, controller (POST /invites/:id/accept|decline), service
src/app.module.ts                             # register the 4 modules
test/home.e2e-spec.ts                         # quickstart scenarios 1–21
```

**Structure Decision**: one folder per feature (`nestjs.md`). Home is its own read-only module because it reads
across workspaces, boards and invites; the board tile and workspace tile selects are shared through a small file in
`home/` that `workspaces/` imports as a plain function (no service cross-import).

## Complexity Tracking

None.
