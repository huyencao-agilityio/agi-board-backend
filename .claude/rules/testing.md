---
paths:
  - 'src/**/*.ts'
  - 'test/**/*.ts'
---

# Testing

Two layers, both run through pnpm scripts (never `npx jest`, Prisma 7 needs `--experimental-vm-modules`):

| Layer | Files                                | Command         | Database                                                   |
| ----- | ------------------------------------ | --------------- | ---------------------------------------------------------- |
| Unit  | `src/**/*.spec.ts`, next to the code | `pnpm test`     | none                                                       |
| E2E   | `test/*.e2e-spec.ts`                 | `pnpm test:e2e` | `agi_board_test`, migrated by `test/setup/global-setup.ts` |

## What each change needs

- **Permission rule** (`src/modules/permissions/`): one row per case in the `it.each` table test, including the deny cases. The table is the readable spec of who can do what (R-02).
- **Pure logic** (validation helpers, position maths, token helpers, config): unit test with plain inputs; no Nest testing module needed.
- **New endpoint**: an e2e test covering at least the happy path, 401 without a session, 404 for a user who cannot see the resource, 400 for invalid input (assert `error.code === 'VALIDATION_FAILED'`). Writes also get one 403 `CSRF_INVALID` case if the route is `@Public()`.
- **Bug fix**: a test that fails before the fix and passes after.
- **New `-- manual:` DB object**: add its name to `test/schema.e2e-spec.ts`.
- **Concurrency-sensitive writes** (re-ordering, card numbers, invites): an e2e test that fires the competing requests with `Promise.all` and asserts the final state.

## E2E conventions

- Build the app like production: `Test.createTestingModule({ imports: [AppModule] })`, then `setupApp(app)` and `app.init()`. Do not re-wire guards, pipes or the filter by hand.
- Use the real database through `PrismaService`; do not mock Prisma in e2e tests.
- Sign in by creating a user with a session row (the `signedIn()` helper pattern in `test/app.e2e-spec.ts`) until the auth endpoints exist; then prefer the real sign-in flow.
- Writes send both the `csrf_token` cookie and the `X-CSRF-Token` header.
- Isolation: test data uses addresses under `@e2e.test` (or another per-file marker) and each file deletes its own rows in `beforeEach`/`afterAll`. Tests must pass in any order and when run alone.
- Assert status, `error.code` and the response shape. Do not assert on human-readable `message` text.

## Unit conventions

- Mock only what crosses a boundary (Prisma, mail, clock). For a service, use `Test.createTestingModule` with `{ provide: PrismaService, useValue: mock }`; keep the mock minimal and typed.
- Time-dependent code takes the time as a parameter or uses `jest.useFakeTimers()`; no `setTimeout` waits in tests.
- No snapshot tests for API responses; assert the fields that matter.

## Reporting

- Run the commands and read the output. A check counts as passed only when its command exited 0 on the current code. If the database is down and e2e cannot run, say so; never report it as passed.
