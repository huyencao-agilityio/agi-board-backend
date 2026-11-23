---
paths:
  - 'src/**/*.ts'
---

# NestJS and API conventions

Layering, global auth and the error envelope are defined in `AGENTS.md`; this file is how to apply them.

## Module layout

- One folder per feature: `src/modules/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `dto/`, and `*.spec.ts`. Register the module in `AppModule.imports`.
- Cross-cutting code lives in `src/common/` (decorators, guards, filters) and is reused, not copied. Permission rules live only in `src/modules/permissions/`.
- `DatabaseModule` provides `PrismaService`; inject it, never `new PrismaClient()` in `src/`.
- Export a service from its module only when another module really needs it; no circular imports, no `forwardRef`.

## Controllers

- Thin: parse input (DTO, `@Param`, `@Query`), read the user with `@CurrentUser()`, call one service method, return its result. No Prisma calls and no business rules in controllers.
- Global pieces are already registered in `AppModule`: `CsrfGuard`, `SessionGuard`, `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`, `AllExceptionsFilter`. Do not register them again per route or per module.
- Route paths: plural kebab-case nouns, nested by ownership (`/workspaces/:workspaceId/boards`, `/boards/:boardId/lists`). The `/api/v1` prefix is global; do not repeat it.
- Validate path ids with `ParseUUIDPipe` (`@Param('boardId', ParseUUIDPipe)`).
- Status codes: `POST` create returns 201 (Nest default); `POST` actions that create nothing (sign-out, archive, move) use `@HttpCode(200)` or `204`; `DELETE` returns 204. Use 404, not 403, for content the user may not see.
- Swagger: add `@ApiTags('<feature>')` on the controller. Document non-obvious responses with `@ApiResponse`.

## DTOs

- Request bodies and queries are classes in `dto/` with `class-validator` decorators; `ValidationPipe` rejects unknown fields. One DTO per operation (`CreateBoardDto`, `UpdateBoardDto`); derive update DTOs with `PartialType` from `@nestjs/swagger`.
- Bound every string (`@MaxLength`) and number (`@Min`/`@Max`) to the DB CHECK constraints (`../docs/database/schema.sql`, or the `-- manual:` CHECKs in the init migration), so violations return 400 instead of a 500 from the database.
- Trim user text with `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)` where the spec trims; normalise emails to lower case.
- No `id`, `createdAt` or owner fields in create DTOs (ids come from Prisma's `uuid(7)`; the owner is `@CurrentUser()`).
- Responses: return plain objects built from an explicit Prisma `select`. Never return a raw model row (it may carry hashes or internal fields).

## Services

- Business rules, permission checks and Prisma calls go here. Load the facts, ask the pure function in `permissions/`, then throw `NotFoundException` (no access) or `ForbiddenException` (visible but not allowed).
- Throw Nest HTTP exceptions with a stable code: `throw new NotFoundException({ code: 'BOARD_NOT_FOUND', message: 'Board not found' })`. Clients branch on `code`, never on `message`.
- Multi-step writes that must be atomic run in one `getBindings().DB.batch([...])` (Prisma's D1 adapter runs `$transaction` (both forms) as separate, non-atomic queries; see `database.md`). Real-time events and emails are sent after it resolves, never inside it.
- Use `Logger` from `@nestjs/common` (`private readonly logger = new Logger(BoardsService.name)`), which pino handles. No `console.log`.

## Lists and pagination

- List endpoints take `?limit=&cursor=` (cursor = last UUIDv7 id seen), default and maximum limit set in the DTO, and return `{ items, nextCursor }`. No offset pagination.

## Config

- A new environment variable is added to `envSchema` in `src/config/env.ts` (with a default only when safe), to `.env.example`, to the CI `env:` block if tests need it, and covered in `env.spec.ts`.
