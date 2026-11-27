# Implementation Plan: #33 Implement feature Create Workspace

**Branch**: `feat/33-implement-feature-create-workspace` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/33/spec.md`

## Summary

Card #33 asks for the create-workspace flow: name, visibility, creator as admin, empty workspace that opens.
The backend part already shipped with ticket #6 (`POST /workspaces`, `GET /workspaces/:workspaceId`,
specs/6 research D6): one `DB.batch` writes the workspace, the creator's `admin` membership and the
`workspace_created` audit row; the name is trimmed, 1–100 characters, duplicates allowed; e2e covers it in
`test/home.e2e-spec.ts` (US1).

This ticket closes the remaining backend gaps only:

1. Line breaks in the name become spaces before storing (WEB-D16 #239). Today only trim runs.
2. An e2e case proving duplicate names are allowed (business rule; no test pins it today).

Two card rules are **not** implemented, by the user's decision on 2026-11-27 (see [research.md](research.md)):
workspace visibility (R1, recorded as an open question) and "no maximum length" (R2, the 100-character limit stays).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (tooling); runtime Cloudflare Workers

**Primary Dependencies**: NestJS 11, class-validator / class-transformer, Prisma 7.10 (D1 adapter)

**Storage**: Cloudflare D1 (SQLite). No schema change.

**Testing**: Jest: `pnpm test` (unit), `pnpm test:e2e` (local D1 in `.wrangler/e2e`)

**Target Platform**: Cloudflare Workers (`wrangler dev` locally)

**Project Type**: web-service (REST API, `/api/v1`)

**Performance Goals**: N/A (one batch per create, unchanged)

**Constraints**: Workers free plan CPU budget; D1 writes atomic only via `DB.batch` (already used)

**Scale/Scope**: one DTO transform line, two e2e cases

## Constitution Check

`.specify/memory/constitution.md` is an unfilled template. Gates come from `AGENTS.md` and `.claude/rules/`.

| Gate | Status |
|---|---|
| Scope = Trello card, nothing outside it | PASS. Card items not built (visibility, no max length) are recorded with the user's decision, not silently dropped |
| Layers: module/controller/service/dto, Prisma or `DB.batch` directly | PASS (no new layer) |
| Auth global, CSRF on writes, `@CurrentUser()` only | PASS (unchanged; CSRF case already tested) |
| Permissions only in `src/modules/permissions/` | PASS (no new permission rule) |
| Validation at the DTO, whitelist on | PASS (normalisation added in the DTO transform) |
| Atomic writes via `DB.batch` | PASS (unchanged) |
| Tests: e2e for HTTP behaviour change | PASS (two e2e cases planned) |
| No new dependency, no migration | PASS |

Post-design re-check: PASS, no violations; Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/33/
├── spec.md
├── plan.md              # this file
├── research.md          # R1 visibility, R2 name length, R3 line breaks, R4 what already exists
├── data-model.md        # no schema change
├── quickstart.md
└── contracts/
    └── workspaces.md    # POST /workspaces delta
```

### Source Code (repository root)

```text
src/modules/workspaces/
└── dto/create-workspace.dto.ts   # name transform: line breaks → space, then trim

test/
└── home.e2e-spec.ts              # US1: line-break case, duplicate-name case
```

**Structure Decision**: existing `src/modules/workspaces/` module; no new files in `src/`.

## Complexity Tracking

None.
