---
paths:
  - 'src/**/*.ts'
  - 'test/**/*.ts'
  - 'prisma/**/*.ts'
---

# Code style (TypeScript)

Formatting is Prettier's job (`.prettierrc`: single quotes, trailing commas, width 120); the PostToolUse hook runs it after every edit. Do not hand-format or argue with it. ESLint (`pnpm lint`) is typed (`recommendedTypeChecked`).

## Files and names

- Files are kebab-case with a role suffix: `boards.controller.ts`, `boards.service.ts`, `boards.module.ts`, `create-board.dto.ts`, `board-access.ts`, `session.guard.ts`, `*.decorator.ts`, `*.filter.ts`. Unit tests sit next to the file as `*.spec.ts`; e2e tests are `test/*.e2e-spec.ts`.
- Classes PascalCase with the role suffix (`BoardsService`, `CreateBoardDto`). Functions and variables camelCase. Module-level constants and metadata keys UPPER_SNAKE (`IS_PUBLIC`, `CSRF_HEADER`). Error codes UPPER_SNAKE strings (`BOARD_NOT_FOUND`).
- Named exports only; no default exports (the e2e `globalSetup` file is the one exception Jest needs).

## Imports

- Node built-ins with the `node:` prefix (`import { randomBytes } from 'node:crypto'`).
- `import type` for anything used only as a type (`import type { Env } from '../config/env'`).
- Relative imports without a file extension. Prisma types come from `src/generated/prisma/client` or `.../enums`, never from `@prisma/client`.

## Types

- No `any` in new code (the lint rule is off, the convention is not). Use `unknown` and narrow.
- `!` non-null assertions only where a guard guarantees the value (e.g. `@CurrentUser()` after `SessionGuard`). Otherwise handle `null`.
- Prefer the types Prisma generates (`User`, `Prisma.BoardSelect`, enums) over re-declaring shapes. Declare an interface only for a shape the code owns (e.g. `SessionUser`, `BoardAccessFacts`).
- Read config through `ConfigService<Env, true>` with `{ infer: true }`. Do not add new `process.env` reads in `src/`.

## Functions and comments

- Small functions with early returns. Pure functions for rules and calculations (see `src/modules/permissions/`), so they are testable without Nest.
- No dead code, commented-out code, or "for later" options.
- Comments explain why, not what. One-line JSDoc on exported symbols whose purpose is not obvious from the name (house style: `/** Skips SessionGuard. CSRF is still checked on writes. */`).
- Code, comments, logs, commit messages: English.
