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

- Multi-row writes use the interactive form `this.prisma.$transaction(async (tx) => ...)` and only `tx` inside it. Keep transactions short: no HTTP calls, emails or event publishing inside.
- Re-ordering (R-06): lists/cards/checklists use a `pos` float. Insert between neighbours by midpoint; when the gap gets too small, renumber the whole list in one transaction after locking the rows with `tx.$queryRaw\`SELECT id FROM cards WHERE list_id = ${listId} FOR UPDATE\``.
- `cards.number` is unique per board with a deferred constraint, so numbers can be swapped inside one transaction.

## Raw SQL

- Only when Prisma cannot express it (`FOR UPDATE`, trigram search, CTEs). Use tagged templates, select explicit columns, and type the result (`$queryRaw<{ id: string }[]>`).
- Remember raw SQL uses table/column names (`snake_case`, `@@map`/`@map`), not model names.

## Schema changes

- After editing `prisma/schema/*.prisma`: `pnpm db:migrate:new <snake_name>`, read the generated SQL (no dropped `-- manual:` object, no unintended data loss), `pnpm db:migrate:dev`, `pnpm db:check`, and `pnpm prisma generate` if types look stale.
- New tables follow the existing schema: `id String @id @default(dbgenerated("uuidv7()")) @db.Uuid`, `createdAt`/`updatedAt` as `@db.Timestamptz(6)`, snake_case `@map`/`@@map`, named indexes (`idx_<table>_<cols>`, `uq_<table>_<cols>`).
- New catalog data goes into `prisma/seed.ts` as an idempotent upsert.
