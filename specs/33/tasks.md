---
description: "Task list for #33 Implement feature Create Workspace"
---

# Tasks: #33 Implement feature Create Workspace

**Input**: `specs/33/` (spec.md, plan.md, research.md, data-model.md, contracts/workspaces.md, quickstart.md)

**Tests**: required by `.claude/rules/testing.md` (HTTP behaviour change → e2e). All cases go in the existing
`describe('US1 create workspace')` block of `test/home.e2e-spec.ts`, so test tasks share one file and are not
parallel with each other.

Scope (plan.md): the endpoint already exists from ticket #6. Only two gaps remain:

- **US1 (P1)**: line breaks in the name become spaces before storing (AC 2 "name is entered and validated";
  WEB-D16 #239; research R3).
- **US2 (P2)**: duplicate workspace names are allowed (business rule; research R4).

Not in scope (user decision 2026-11-27): workspace visibility (research R1, open question) and removing the name
limit (research R2, "trimmed, 1–100 characters" stays). Do not add a `visibility` field, a migration, or touch
`@MaxLength(100)`.

Rules every task follows:
- Validation stays in `CreateWorkspaceDto`; `WorkspacesService.create` and its `DB.batch` are not changed.
- E2E: use the file's `signedIn()` and `write('post', me, '/workspaces')` helpers; assert status, `error.code`
  and response fields, never `message` text.

## Phase 1: Setup

No setup: worktree, dependencies and local D1 are ready (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed` done).

## Phase 2: Foundational

None.

## Phase 3: User Story 1 - Line breaks become spaces (Priority: P1) 🎯 MVP

**Goal**: `POST /workspaces` stores and returns the name with each run of `\r`/`\n` replaced by one space, then
trimmed, and validates that stored form.

**Independent Test**: `{ "name": "Team\nAlpha" }` → 201 with `name: "Team Alpha"`; `{ "name": "\n\n" }` → 400
`VALIDATION_FAILED`.

### Tests for User Story 1

- [X] T001 [US1] In `test/home.e2e-spec.ts`, inside `describe('US1 create workspace')`, add `it('turns line breaks into spaces before storing')`: post `{ name: ' Team\r\nAlpha\n\nBeta ' }`, expect 201 and `body.name === 'Team Alpha Beta'`, and the `audit_log_entries` row's `targetLabel === 'Team Alpha Beta'`. Also add `[{ name: '\n\n' }]` and `[{ name: '\r\n \n' }]` to the existing `it.each` 400 `VALIDATION_FAILED` table. Run `pnpm test:e2e -- home` and confirm the new 201 case fails before T002.

### Implementation for User Story 1

- [X] T002 [US1] In `src/modules/workspaces/dto/create-workspace.dto.ts`, change the `@Transform` to `typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : value`. Keep `@IsString()`, `@IsNotEmpty()` and `@MaxLength(100)` as they are (rule: "trimmed, 1–100 characters"). Update the `@ApiProperty` description to `'Line breaks become spaces, then trimmed; 1–100 characters.'` and extend the existing comment with one line citing WEB-D16 #239 (the name is copied into the audit log, so every client must store the single-line form).

**Checkpoint**: T001 passes.

## Phase 4: User Story 2 - Duplicate names allowed (Priority: P2)

**Goal**: pin the business rule "Duplicate workspace names MUST be allowed" with a test. No code change expected
(there is no unique index on `workspaces.name`).

**Independent Test**: posting the same name twice returns two 201s with different ids, both on `GET /home`.

### Tests for User Story 2

- [X] T003 [US2] In `test/home.e2e-spec.ts`, inside `describe('US1 create workspace')`, add `it('allows two workspaces with the same name')`: the same signed-in user posts `{ name: 'Team' }` twice, expect both 201, `first.id !== second.id`, and `(await home(me)).workspaces.map((w) => w.id)` contains both ids. If it fails, stop and report: the fix would need a migration, which is outside this plan.

**Checkpoint**: T003 passes.

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T004 Update the 400 description of `@Post()` in `src/modules/workspaces/workspaces.controller.ts` to `'VALIDATION_FAILED (name missing, blank after line breaks are replaced and trimmed, over 100 characters, unknown field)'`.
- [X] T005 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` in the worktree; all must exit 0 (`specs/33/quickstart.md`).
- [X] T006 Run the `code-reviewer` agent on the diff and fix Critical/High findings (CLAUDE.md flow; `security-auditor` too, since a DTO changes).

## Dependencies & Execution Order

- T001 → T002 (test first, then the transform).
- T003 is independent of US1 code but edits the same test file as T001: run after T001.
- T004 after T002 (same wording). T005 after T001–T004. T006 after T005.
- Story order: US1 (MVP) then US2; US2 does not depend on US1 behaviour.

## Parallel Opportunities

- T004 (controller) can run in parallel with T003 (test file): different files, no dependency.
- Everything else is sequential: two tasks share `test/home.e2e-spec.ts`, and the checks need all edits.

```text
After T002:  T003 [US2] test/home.e2e-spec.ts  ||  T004 src/modules/workspaces/workspaces.controller.ts
```

## Implementation Strategy

- **MVP**: Phase 3 (T001–T002), the only behaviour change.
- Then Phase 4 (one test), Phase 5 (docs line, checks, review). One commit is enough, e.g.
  `feat(workspaces): #33 Turn line breaks in workspace names into spaces`.
