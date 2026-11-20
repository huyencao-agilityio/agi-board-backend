# agi-board-backend

REST API for AGI Board: NestJS 11, Prisma 7, PostgreSQL 18+, Node.js 24.

## Run locally

Requirements: Node.js 24 (`nvm use`), Docker, pnpm via Corepack (`corepack enable pnpm`).

```bash
pnpm install          # also runs `prisma generate`
cp .env.example .env
pnpm db:up            # PostgreSQL 18 + Mailpit
pnpm db:migrate       # apply migrations
pnpm db:seed          # label colors, board backgrounds (safe to re-run)
pnpm start:dev        # http://localhost:3000/api/v1/health
```

| URL                                               | What                            |
| ------------------------------------------------- | ------------------------------- |
| http://localhost:3000/api/v1/health, `/health/db` | Liveness, database check        |
| http://localhost:3000/api/docs                    | Swagger (not in production)     |
| http://localhost:8025                             | Mailpit: emails sent by the API |

Run the API in Docker instead (same image as deployment): `docker compose --profile app up --build`.

## Scripts

| Script                                                        | Does                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm typecheck` | Code quality                                                             |
| `pnpm test`                                                   | Unit tests (`src/**/*.spec.ts`)                                          |
| `pnpm test:e2e`                                               | e2e tests against the `agi_board_test` database (migrated automatically) |
| `pnpm db:migrate:new <name>`                                  | Create a migration from schema changes, **without applying it**          |
| `pnpm db:migrate:dev`                                         | Apply pending migrations locally and check drift                         |
| `pnpm db:migrate`                                             | Apply migrations (`migrate deploy`, used by CI and deploy)               |
| `pnpm db:seed`                                                | Seed system catalogs                                                     |
| `pnpm db:reset`                                               | Drop the local database, re-migrate, seed                                |
| `pnpm db:check`                                               | Fails if `prisma/schema` has changes with no migration                   |
| `pnpm db:studio`                                              | Prisma Studio                                                            |

## Database workflow

The Prisma models in `prisma/schema/` are the source of truth; `docs/database/schema.sql` in the
`agi-board` repo is the original design.

1. Edit the models.
2. `pnpm db:migrate:new <name>` and **read the generated SQL**.
3. `pnpm db:migrate:dev` to apply, then commit the model and migration together.

Prisma cannot express CHECK constraints, expression indexes, `NULLS NOT DISTINCT` and DEFERRABLE
constraints. They are hand-written at the end of the init migration (`-- manual:` comments).
If a new migration touches those tables, check it does not drop them; `test/schema.e2e-spec.ts`
fails if one goes missing. New objects of that kind: add them by hand to the new migration and to
that test.

## Layout

```
src/
  main.ts, app.setup.ts     bootstrap; HTTP setup shared with e2e tests
  app.module.ts             global guards (CSRF, session), validation pipe, error filter
  config/env.ts             environment schema, validated at startup
  database/                 PrismaService
  common/                   guards, decorators, error filter
  modules/<feature>/        one folder per feature: module, controller, service, dto/, *.spec.ts
  generated/prisma/         Prisma client (generated, not committed)
prisma/                     schema/, migrations/, seed.ts
test/                       e2e tests
edge/                       Cloudflare gateway Worker + Durable Object (planned, not implemented)
```

## API conventions

- Prefix `/api/v1`, JSON in camelCase.
- Errors: `{ "error": { "code": "...", "message": "...", "details": [...] } }`.
- Every route needs a session unless marked `@Public()`. The session is an httpOnly cookie
  (`SESSION_COOKIE_NAME`) whose SHA-256 hash is stored in `user_sessions`.
- CSRF (double submit): `GET` responses set a readable `csrf_token` cookie; every write must send
  the same value in the `X-CSRF-Token` header.
- Board permission rules live in `src/modules/permissions/` as pure functions with a table test.
  System roles never grant access to workspace or board content.

## Contributing

- Branch from `main`, open a PR; review is required and CI must pass.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, ...).
- PR description uses the template: What / Why / How tested / Screenshots / Risk.
