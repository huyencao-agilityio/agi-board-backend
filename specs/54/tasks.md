---

description: "Task list for #54 User logout (backend)"
---

# Tasks: #54 Implement feature user logout (backend)

**Input**: Design documents from `specs/54/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-logout.md, quickstart.md

**Tests**: Required. The card asks "Unit tests cover the session-ending logic", and `.claude/rules/testing.md` requires e2e tests for a new endpoint.

**Scope**: The card's **Backend** acceptance criteria only. Frontend criteria belong to the frontend repo.

**User stories** (the card has none; grouped from its backend acceptance criteria):

- **US1 (P1)**: A signed-in user logs out. The session ends, cookies are cleared, the old cookie no longer works, CSRF is enforced, and other devices stay signed in. Covers backend AC 1–4 and the "current session only" rule.
- **US2 (P2)**: Logout is idempotent. An already-ended session answers 204, and no or unknown cookie answers 401. Covers backend AC 5 and research D1/D2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

## Phase 1: Setup

- [X] T001 Copy `.env` and `.dev.vars` from the main checkout into `/home/huyencao/Documents/training/agi-board/agi-board-backend-54/` (the user does this; the guard hook blocks agents from reading `.env`), then confirm a baseline: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all pass before any change

---

## Phase 2: Foundational

**Purpose**: The cookie helper both stories use.

- [X] T002 Add `clearAuthCookies(res: Response, config: ConfigService<Env, true>)` to `src/common/session-cookie.ts`. It calls `res.clearCookie(config.get('SESSION_COOKIE_NAME'), { httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', path: '/' })` and `res.clearCookie(CSRF_COOKIE, { sameSite: 'lax', secure: NODE_ENV === 'production', path: '/' })`. The options must match `setSessionCookie` and `CsrfGuard`, otherwise browsers keep the cookies (research D3). Import `CSRF_COOKIE` from `./guards/csrf.guard`; check this creates no import cycle. Give it a one-line doc comment

**Checkpoint**: `pnpm typecheck` clean.

---

## Phase 3: User Story 1 — Log out of the current session (Priority: P1) 🎯 MVP

**Goal**: `POST /auth/logout` with a live session ends that session and clears both cookies, and only that session.

**Independent Test**: Sign in, call logout with the CSRF header → 204. The row has `endedAt` set and `endReason = 'logout'`, `Set-Cookie` clears both cookies, and `GET /auth/me` with the old cookie → 401 (not `SESSION_ENDED`).

### Tests for User Story 1 (write first, see them fail)

- [X] T003 [P] [US1] Add a `describe('logout')` block to `src/modules/auth/session/session.service.spec.ts`. Extend the existing Prisma mock with `userSession.findUnique`, and the `res` mock with `clearCookie`. Use a request mock with `cookies: { agi_sid: '<token>' }`. Case: live session (`updateMany` resolves `{ count: 1 }`) → `updateMany` called with `{ where: { tokenHash: hashSessionToken(token), endedAt: null }, data: { endedAt: expect.any(Date), endReason: 'logout' } }`, `findUnique` not called, `clearCookie` called for `agi_sid` and `csrf_token`
- [X] T004 [P] [US1] Add a `describe('POST /auth/logout')` block to `test/session.e2e-spec.ts`, using the file's existing `@session.e2e.test` cleanup. Get a CSRF cookie, then sign in with the real `POST /auth/sign-in` (create a password user in the test the way `test/auth.e2e-spec.ts` does). Cases:
  - (a) logout with session cookie + `csrf_token` cookie + `X-CSRF-Token` header → 204, and the DB row has `endedAt` not null and `endReason === 'logout'`;
  - (b) the response's `set-cookie` header clears `agi_sid` and `csrf_token` (expired date or `Max-Age=0`, `Path=/`);
  - (c) `GET /api/v1/auth/me` with the logged-out cookie → 401 and `error.code !== 'SESSION_ENDED'`;
  - (d) logout without the `X-CSRF-Token` header, and with a wrong one → 403 `CSRF_INVALID`, and the session row still has `endedAt === null`;
  - (e) a user with two sessions (use `makeSession`-style seeding for the second) logs out of one → the other still answers 200 on `GET /api/v1/auth/me`

### Implementation for User Story 1

- [X] T005 [US1] Add `async logout(req: Request, res: Response): Promise<void>` to `src/modules/auth/session/session.service.ts`:
  - read the token from `req.cookies[config.get('SESSION_COOKIE_NAME')]`;
  - `updateMany({ where: { tokenHash: hashSessionToken(token), endedAt: null }, data: { endedAt: new Date(), endReason: 'logout' } })`;
  - when `count === 1`, call `clearAuthCookies(res, this.config)`.

  The `endedAt: null` condition keeps the first `endReason` of a session already ended by something else (research D2). Leave the `count === 0` branch to T008. Log nothing about the token
- [X] T006 [US1] Add the route to `src/modules/auth/auth.controller.ts`:
  - `@Public()`, with a one-line why-comment: "Public so an already-ended session still gets 204; the service requires a known session cookie. CSRF still applies.";
  - `@Post('logout')`, `@HttpCode(204)`;
  - `@ApiResponse` entries for 204 (session ended, cookies cleared), 401 (no session cookie or unknown token) and 403 (`CSRF_INVALID`);
  - handler `logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.sessions.logout(req, res); }`

**Checkpoint**: T003 and T004 (a)–(e) pass.

---

## Phase 4: User Story 2 — Idempotent logout and missing session (Priority: P2)

**Goal**: A repeat logout on an ended session answers 204 and leaves the row unchanged; no cookie or an unknown token answers 401 (research D1).

**Independent Test**: Log out twice with the same cookie → both 204, and `endedAt` is unchanged after the second call. A session ended as `password_reset` → logout 204 and `endReason` stays `password_reset`. No cookie → 401, unknown token → 401.

### Tests for User Story 2

- [X] T007 [P] [US2] Add cases to the `describe('logout')` block in `src/modules/auth/session/session.service.spec.ts`:
  - `updateMany` → `{ count: 0 }` and `findUnique` → `{ id: 's1' }` → resolves, `clearCookie` called twice, no further write;
  - `updateMany` → `{ count: 0 }` and `findUnique` → `null` → rejects with `UnauthorizedException`, `clearCookie` not called;
  - no session cookie → rejects with `UnauthorizedException`, and neither `updateMany` nor `findUnique` is called
- [X] T008 [US2] Add cases to `describe('POST /auth/logout')` in `test/session.e2e-spec.ts`:
  - (f) logout twice with the same cookie → both 204, and `endedAt` after the second call equals `endedAt` after the first;
  - (g) a session seeded with `makeSession({ endReason: 'password_reset' })` → logout 204, `endReason` still `password_reset`, cookies cleared;
  - (h) no session cookie (CSRF cookie and header present) → 401 `UNAUTHORIZED`;
  - (i) unknown token cookie → 401 `UNAUTHORIZED`

### Implementation for User Story 2

- [X] T009 [US2] Complete `logout` in `src/modules/auth/session/session.service.ts`:
  - no token → `throw new UnauthorizedException()` before any query;
  - when `updateMany` returns `count === 0`, run `prisma.userSession.findUnique({ where: { tokenHash }, select: { id: true } })`: `null` → `throw new UnauthorizedException()`; found → `clearAuthCookies(res, this.config)` and return (204).

  Do not throw a new error code; a plain `UnauthorizedException` matches `SessionGuard`'s 401 body (`UNAUTHORIZED`, contract)

**Checkpoint**: T007 and T008 (f)–(i) pass; US1 tests still pass.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T010 [P] Add one line under "Authentication and sessions" in `.claude/rules/security.md`: `POST /auth/logout` is the one `@Public()` route that needs a session. It checks the session cookie itself (401 without a known one) so that an already-ended session still answers 204 (specs/54/research.md D1, approved by the project owner)
- [X] T011 [P] Update the `SessionGuard` doc comment in `src/common/guards/session.guard.ts` only if it no longer reads correctly. Its wording "one ended by anything except logout answers SESSION_ENDED" still holds, so the expected outcome is no change
- [X] T012 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` in the worktree and fix every failure. Then check the scenarios in `specs/54/quickstart.md` 1–8 against the test names
- [X] T013 Run the `code-reviewer` agent and the `security-auditor` agent (the change touches auth, a controller and a Prisma query), fix Critical/High findings, re-run T012, then `/create-pr`

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002)** → **US1 (T003–T006)** → **US2 (T007–T009)** → **Polish (T010–T013)**
- US2 extends the same `logout` method and test blocks as US1, so it runs after US1 (same files, not parallel).
- Within US1: T003 and T004 [P] (different files) before T005 → T006.
- Within US2: T007 [P] can be written alongside T008; T009 after both.
- T010 and T011 [P] can run any time after T006.

## Parallel Example: User Story 1

```text
T003 unit tests in src/modules/auth/session/session.service.spec.ts
T004 e2e tests in test/session.e2e-spec.ts
```

## Implementation Strategy

1. **MVP = US1**: logout ends the live session and clears the cookies. That alone meets backend AC 1–4.
2. **US2**: adds idempotency (AC 5) and the 401 for a missing or unknown session.
3. Polish, the checks, review agents, then `/create-pr`.
