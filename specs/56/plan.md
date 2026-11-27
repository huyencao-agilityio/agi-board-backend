# Implementation Plan: #56 Decide and implement audit log for self-service account security actions

**Branch**: `feat/56-audit-log-self-service-security-actions` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/56/spec.md`

## Summary

Write one `audit_log_entries` row, in the same `DB.batch` as the change, for four self-service actions: change password, sign out one session, sign out all other sessions, and password reset completed (clarification Q1). The rows are write only (Q2). `data` is `{"sessionId": …}` for a single sign-out and `{}` for the other three (Q3). A shared helper builds a guarded `INSERT … SELECT` from `users`, so the name is copied at the time and a false guard writes nothing (research D1). Change password and reset add the insert to their existing batches. The two session sign-outs move from Prisma `updateMany` to raw SQL in a batch, guarded by `changes()` (D3). There is no HTTP contract change and no migration: four enum values only (D5).

## Technical Context

**Language/Version**: TypeScript 5.9, NestJS 11, Prisma 7.10 (D1 adapter), Node 24 tooling

**Primary Dependencies**: existing only: D1 binding `DB` via `getBindings()`, Web Crypto `getRandomValues`

**Storage**: D1 `audit_log_entries` (existing table), `users`, `user_sessions`, `password_reset_tokens`; no migration

**Testing**: Jest unit (`src/common/audit-log.spec.ts`), e2e against local D1 (`test/account-security.e2e-spec.ts`, `test/password-reset.e2e-spec.ts`)

**Target Platform**: Cloudflare Workers

**Project Type**: web-service (REST API)

**Performance Goals**: one extra statement inside each existing batch; the session sign-outs go from one Prisma query to one batch (two statements)

**Constraints**: atomic only through `DB.batch`; no personal data in `data`; audit rows never updated or deleted by the app

**Scale/Scope**: 2 services changed, 1 new common file, 4 enum values, ~10 e2e cases, 1 unit test

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| The card is the scope | Pass: four actions from Q1; no read API (Q2); logout left out |
| Security-relevant actions write an audit row in the same transaction | Pass: same `DB.batch` (D1, D3) |
| Audit `data` holds ids and action data, not personal data | Pass: `sessionId` or `{}` (Q3) |
| Atomic writes via `DB.batch`, not `$transaction` | Pass: session sign-outs moved to a batch |
| Raw SQL with bound values only | Pass: D1 `prepare().bind()`; no request value concatenated into SQL |
| IDs are UUIDv7 | Pass: `uuidv7()` helper (D2) |
| No new dependency | Pass |
| Error codes and statuses unchanged | Pass: see contracts/http.md |
| Schema change needs a migration | Pass: enum values only, D1 does not enforce them; `pnpm db:check` |
| Bug-fix/feature tests | Planned: quickstart.md scenarios 1–10 |

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/56/
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
prisma/schema/enums.prisma                                # + 4 AuditAction values
src/common/audit-log.ts                                   # new: uuidv7(), sqlDate(), auditStatement()
src/common/audit-log.spec.ts                              # new: uuidv7 unit test
src/modules/auth/account/account-security.service.ts      # changePassword insert; endSession/endOtherSessions → DB.batch
src/modules/auth/password-reset/password-reset.service.ts # applyReset insert before the link update
test/account-security.e2e-spec.ts                         # scenarios 1–8, audit cleanup
test/password-reset.e2e-spec.ts                           # scenarios 9–10, audit cleanup
```

**Structure Decision**: the helper goes in `src/common/` because two auth services use it. It is not a Nest provider: it only builds a prepared statement, and the services already call `getBindings()`.

## Complexity Tracking

None.
