---
paths:
  - 'src/**/*.service.ts'
  - 'src/database/**'
  - 'prisma/**'
  - 'test/**/*.ts'
---

# Database access (Prisma)

Schema and migration rules (manual objects, no `db push`, never edit an applied migration) are in `AGENTS.md`. This file covers queries.

## Queries

- Always `select` (or a narrow `include` with nested `select`) the fields the response needs. No bare `findMany()` returning whole rows.
- Use `findUnique` on a unique key; `findFirst` only with a filter that is not unique. Throw the feature's `*_NOT_FOUND` exception when a row is missing or not visible, rather than relying on Prisma P2025 (the filter maps it to a generic `NOT_FOUND`).
- Put the permission filter in the query when listing (e.g. only boards the user can see), so hidden rows are never loaded and pagination counts stay correct.
- No N+1: load related rows with `include`/`select` or one `findMany({ where: { id: { in: ids } } })`, not a query per item in a loop.
- Archived and closed rows: lists and cards with `archivedAt`, boards with `closedAt`, users with `deactivatedAt`. Normal reads filter `archivedAt: null` / `closedAt: null`; only archive/restore screens read them. The partial indexes (`idx_*_active`, `WHERE archived_at IS NULL`) assume that filter.
- Unique conflicts: let Prisma raise P2002 (mapped to 409 `CONFLICT`) or catch it and throw a feature-specific 409 code; do not pre-check with a separate read (race).

## Transactions and ordering

- D1 has no interactive transactions, and Prisma's D1 adapter runs `$transaction` (both forms) as separate, non-atomic queries. Writes that must be all-or-nothing go through D1's own batch, `getBindings().DB.batch([...prepared statements])` (one implicit transaction), or are a single SQL statement. Compute everything first; no HTTP calls, emails or event publishing inside.
- Re-ordering (R-06): lists/cards/checklists use a `pos` float. Insert between neighbours by midpoint; when the gap gets too small, renumber the whole list in one `DB.batch`. SQLite has no `FOR UPDATE`; D1 runs one write at a time, so a batch is not interleaved with other writes.
- `cards.number` is unique per board, checked per statement (no DEFERRABLE in SQLite): swap numbers through a temporary value (e.g. negative) inside one `DB.batch`.

## Raw SQL

- Only when Prisma cannot express it (CTEs, expression filters). SQLite syntax: no `ILIKE`, `::casts` or Postgres functions. Use tagged templates, select explicit columns, and type the result (`$queryRaw<{ id: string }[]>`).
- Remember raw SQL uses table/column names (`snake_case`, `@@map`/`@map`), not model names.

## Schema changes

- After editing `prisma/schema/*.prisma`: `pnpm db:migrate:new <snake_name>`, `pnpm db:diff >> <the new file>`, read the SQL (a table rebuild must keep the `-- manual` CHECKs, no unintended data loss), `pnpm db:migrate`, `pnpm db:check`, and `pnpm prisma generate` if types look stale.
- New tables follow the existing schema: `id String @id @default(uuid(7))`, `createdAt`/`updatedAt` `DateTime`, snake_case `@map`/`@@map`, named indexes (`idx_<table>_<cols>`, `uq_<table>_<cols>`).
- New catalog data goes into `prisma/seed.sql` as an idempotent `INSERT ... ON CONFLICT DO UPDATE` (deploy re-runs it).
