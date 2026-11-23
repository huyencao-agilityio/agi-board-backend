---

description: "Task list for #4 Implement feature User Sign In (backend)"
---

# Tasks: #4 Implement feature User Sign In

**Input**: `specs/4/` (plan.md, spec.md, research.md, data-model.md, contracts/auth-sign-in.md, quickstart.md)

**Prerequisites**: plan.md, spec.md. Worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`).

**Tests**: included. `.claude/rules/testing.md` requires an e2e test for every new endpoint and a unit test for pure logic. Write each story's tests first and watch them fail.

**Scope**: backend only. Acceptance criteria that are pure UI (disabled button, spinner, inline email error text, show/hide password, links to WEB-14/WEB-02, "Password updated" notice) belong to the frontend ticket and have no tasks here.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- Tasks that edit `src/modules/auth/auth.service.ts` or `auth.controller.ts` are never `[P]` against each other
- Commit subject format: `<type>(auth): #4 <Imperative summary>`

## Phase 1: Setup

- [X] T001 (done; outcome: free plan cannot run argon2id, switched to PBKDF2-SHA256, see research R1) Spike for research R1: add `@noble/hashes` (exact version, no `^`) to `package.json`, hash and verify one password with argon2id inside `wrangler dev` (throwaway route or script, not committed), record the chosen parameters (memory, iterations, parallelism) and the measured time in the "R1" section of `specs/4/research.md`. If the time does not fit the Worker CPU limit, STOP and ask the user; do not switch algorithm or weaken parameters on your own.
- [X] T002 [P] Add env vars. In `src/config/env.ts` `envSchema`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (string, min 1) and `GOOGLE_REDIRECT_URI` (`z.url()`), all optional outside production and required when `NODE_ENV === 'production'` (a `superRefine` on the schema, so staging and production refuse to start without them while local dev and tests still boot); `SESSION_IDLE_DAYS` (positive integer, default 7). When a Google variable is unset outside production, `GET /auth/google` redirects to `/sign-in?error=google_failed` instead of crashing. Cover all four in `src/config/env.spec.ts` (including the production-requires-Google case). Add placeholders (no real values) to `.env.example`. Add fake values (`GOOGLE_CLIENT_ID=e2e-client`, `GOOGLE_CLIENT_SECRET=e2e-secret`, `GOOGLE_REDIRECT_URI=http://localhost:8787/api/v1/auth/google/callback`) with `??=` in `test/setup/global-setup.ts`. In `wrangler.jsonc` add `GOOGLE_REDIRECT_URI` to `vars` of the top level, `env.staging` and `env.production`, each with that environment's callback URL, built on the FRONTEND origin (`APP_ORIGIN`) because the frontend proxies `/api` to this backend: the browser must reach `/auth/google` and `/auth/google/callback` through that proxy, otherwise the session and state cookies are set on the backend domain, which is cross-site (workers.dev is a public suffix) and the frontend never sends them. Local `http://localhost:5173/api/v1/auth/google/callback` (Vite proxy, frontend ticket) or `http://localhost:8787/api/v1/auth/google/callback` when hitting wrangler directly; staging `https://agi-board-staging.huyen-cao.workers.dev/api/v1/auth/google/callback`; production `https://agi-board-app.huyen-cao.workers.dev/api/v1/auth/google/callback` (origins taken from `APP_ORIGIN` in `wrangler.jsonc`; the proxy must keep the `/api/v1` path and pass `Set-Cookie` and the 302 `Location` through unchanged). `GOOGLE_CLIENT_ID` goes in the same `vars` once the client provides it. All three callback URLs must be registered as authorised redirect URIs in the client's Google Cloud OAuth project. `GOOGLE_CLIENT_SECRET` is only a secret: `wrangler secret put --env <env>`, and note that step in the PR Risk section. The `ci.yml` `check` job has no `env:` block and needs none.
- [X] T003 [P] Add `expired` to `enum SessionEndReason` in `prisma/schema/enums.prisma` (keep existing values), run `pnpm prisma generate`, then `pnpm db:check`. It must report no migration diff (D1 does not enforce enums). If it does, STOP and ask.

---

## Phase 2: Foundational (blocks all user stories)

**⚠️ CRITICAL**: no story starts until this phase is done.

- [X] T004 [P] Create `src/modules/auth/password.service.ts` with `hash(password)` and `verify(password, phcHash)` using argon2id and the parameters from T001, PHC string format, plus `verifyDummy(password)` that verifies against a fixed pre-computed hash so unknown emails take similar time (research R4). Never log or return a password or hash. "Similar timing" for unknown emails is best effort (the dummy verify costs one hash, same as a real verify); it is not asserted by a timing test. Unit test in `src/modules/auth/password.service.spec.ts`: hash then verify true, wrong password false, `verifyDummy` always false.
- [X] T005 [P] Create `src/modules/auth/sign-in-throttle.service.ts` on the `auth_throttles` table: `scope = sign_in`, `subjectKey = sha256(lower-cased email)` (never store the email), methods `isLocked(email, now)`, `recordFailure(email, now)` and `reset(email)`. The 5th consecutive failure sets `lockedUntil = now + 15 min`; while `lockedUntil > now` nothing is counted; after it passes the count starts again at 1; success calls `reset`. Increment with one atomic tagged-template `$executeRaw` (`failed_count = failed_count + 1`), not read-modify-write (research R3). Time is a parameter (no `setTimeout` in tests). Known limit (accepted): a row is created for every email tried, including unknown ones, and nothing deletes old rows; `shortcut: no cleanup of stale auth_throttles rows, add a periodic delete of rows with locked_until and updated_at older than 30 days when the table grows`. Put that comment in the code. Unit test in `src/modules/auth/sign-in-throttle.service.spec.ts` covering: count 1 to 4, lock on 5th, locked attempt not counted, unlock after 15 min, `reset` unlocks, same key for different letter case of the same email.
- [X] T006 Create `src/modules/auth/auth.module.ts`, `src/modules/auth/auth.service.ts` and `src/modules/auth/auth.controller.ts` (`@ApiTags('auth')`, controller prefix `auth`, no routes yet) and import `AuthModule` in `src/app.module.ts`. In `AuthService` add `createSession(user, req, res)`: `newSessionToken()`, store `hashSessionToken(token)` with `userAgent` and `ipAddress` (from `cf-connecting-ip`, falling back to `req.ip`) in `user_sessions`, set `users.lastSignInAt`, and set the cookie named `SESSION_COOKIE_NAME` with `httpOnly: true`, `sameSite: 'lax'`, `secure` when `NODE_ENV === 'production'`, `path: '/'`, `maxAge` = `SESSION_IDLE_DAYS` days. Return `{ user: { id, email, fullName, systemRole }, next }` where `next` is `"verify-email"` when `emailVerifiedAt` is null, else `"home"`; build it from an explicit `select`, never return `passwordHash`. This task does not depend on any other task.

**Checkpoint**: module compiles (`pnpm typecheck`); services unit-tested.

---

> **Dependency outside this ticket**: US1 acceptance criterion 7 ("the lock is lifted when the person sets a new password with a reset link") is only fully met once the reset-password ticket (WEB-15) calls `SignInThrottleService.reset(email)` (T005). This ticket delivers and tests `reset`; make sure the reset-password ticket lists the call in its scope.

## Phase 3: User Story 1 - Sign in with email and password (P1) 🎯 MVP

**Goal**: `POST /api/v1/auth/sign-in` per [contracts/auth-sign-in.md](./contracts/auth-sign-in.md), including lockout.

**Independent Test**: `pnpm test:e2e -- auth` cases 1 to 7 of [quickstart.md](./quickstart.md) pass; calling the endpoint with a created user returns a session cookie that `SessionGuard` accepts on a protected route.

### Tests for User Story 1 (write first, they must fail)

- [X] T007 [US1] Create `test/auth.e2e-spec.ts` (build the app with `Test.createTestingModule({ imports: [AppModule] })` + `setupApp`, users at `@e2e.test`, each file cleans its own rows, writes send the `csrf_token` cookie and `X-CSRF-Token` header) with: valid verified user → 200 `next: "home"` and cookie flags and `lastSignInAt` set; unverified → 200 `next: "verify-email"`; wrong password and unknown email and Google-only account (null `passwordHash`) → identical 401 `INVALID_CREDENTIALS` body; deactivated + correct password → 403 `ACCOUNT_DEACTIVATED`, deactivated + wrong password → 401 `INVALID_CREDENTIALS`; 5 wrong passwords then the 6th → 429 `SIGN_IN_LOCKED` (also for an unknown email) and the 6th is not counted; 5 parallel wrong passwords via `Promise.all` never push `failed_count` above 5; correct password during lock → 429; successful sign-in clears the counter; missing CSRF → 403 `CSRF_INVALID`. Assert status and `error.code`, not message text.

### Implementation for User Story 1

- [X] T008 [P] [US1] Create `src/modules/auth/dto/sign-in.dto.ts`: `email` with trim then lower-case transform, `@IsEmail()`, `@MaxLength(254)`; `password` `@IsString()`, `@IsNotEmpty()`, `@MaxLength(128)`, no strength rules; no other fields (the global `ValidationPipe` rejects unknown ones).
- [X] T009 [US1] Add `signIn(dto, req, res)` to `src/modules/auth/auth.service.ts`. Order: throttle `isLocked` → 429 `SIGN_IN_LOCKED` with message "Too many attempts. Try again in 15 minutes."; load user by email; if none or no `passwordHash`, run `verifyDummy`, `recordFailure`, throw 401 `INVALID_CREDENTIALS` "Email or password is incorrect."; wrong password → same `recordFailure` + same 401; correct password and `deactivatedAt` set → throw 403 `ACCOUNT_DEACTIVATED` "This account has been deactivated. Contact your administrator." (do not count it as a failure); otherwise throttle `reset` and `createSession`. Throw Nest exceptions with `{ code, message }`. Log ids only, never the email.
- [X] T010 [US1] Add `@Post('sign-in')` `@HttpCode(200)` to `src/modules/auth/auth.controller.ts`, marked `@Public()` with a one-line comment (signed-out users must reach it; CSRF still applies), body `SignInDto`, `@Res({ passthrough: true })`, `@ApiResponse` for 200, 400, 401, 403, 429. Run `pnpm test:e2e -- auth` until T007 passes.

**Checkpoint**: MVP. Email + password sign-in works end to end.

---

## Phase 4: User Story 2 - Sign in with Google (P1)

**Goal**: `GET /auth/google` and `GET /auth/google/callback` per the contract.

**Independent Test**: quickstart e2e case 8 passes (token exchange faked at the `fetch` boundary); manual Google check once credentials exist.

### Tests for User Story 2 (write first)

- [X] T011 [P] [US2] Create `src/modules/auth/google-oauth.service.spec.ts`: id_token claim checks reject wrong `iss`, wrong `aud`, expired `exp`, `email_verified` false; `state` mismatch rejected; accepts both `accounts.google.com` and `https://accounts.google.com` as `iss`.
- [X] T012 [US2] Add Google cases to `test/auth.e2e-spec.ts` with `fetch` stubbed (`jest.spyOn(global, 'fetch')`, no real network): new Google user created (`passwordHash` null, `emailVerifiedAt` and `googleSubject` set) → 302 to `${APP_ORIGIN}/home` with session cookie; existing password account with the same email → linked, still exactly one `users` row, no error; account on any email domain accepted; `error=access_denied` → 302 `${APP_ORIGIN}/sign-in` with no `error` parameter and no cookie; bad `state`, failed exchange and invalid id_token → 302 `${APP_ORIGIN}/sign-in?error=google_failed`; deactivated user → 302 `${APP_ORIGIN}/sign-in?error=account_deactivated`; state cookie cleared in every case.

### Implementation for User Story 2

- [X] T013 [P] [US2] Create `src/modules/auth/google-oauth.service.ts` with plain `fetch` and Web Crypto only (research R2): `buildAuthUrl()` returning the URL plus `state` and PKCE `code_verifier` (random, S256 challenge), `exchangeCode(code, verifier)` against `https://oauth2.googleapis.com/token`, and `verifyIdToken` checking `iss`, `aud` equals `GOOGLE_CLIENT_ID`, `exp`, and `email_verified === true`, returning `{ sub, email (lower-cased), name }`. Secrets only from `ConfigService`; never log codes or tokens; no email or code in any URL the app logs.
- [X] T014 [US2] Add `signInWithGoogle(profile, req, res)` to `src/modules/auth/auth.service.ts`: find by `googleSubject`, else by lower-cased email and set `googleSubject` (and `emailVerifiedAt` if null), else create the user (`fullName` = Google name, falling back to the email local part; `passwordHash` null; `emailVerifiedAt` now). A user with `deactivatedAt` set is refused with a signal the controller turns into `account_deactivated`. On success call `createSession`.
- [X] T015 [US2] Add to `src/modules/auth/auth.controller.ts` `@Public()` (with why-comments) `@Get('google')`: set a short-lived httpOnly `sameSite: 'lax'` cookie holding `state` and the verifier, answer 302 to Google; and `@Get('google/callback')`: handle every outcome of the contract table (success → `/home`, or `/verify-email` when unverified; `access_denied` → `/sign-in`; other failures → `/sign-in?error=google_failed`; deactivated → `/sign-in?error=account_deactivated`), redirecting to `APP_ORIGIN` + path and clearing the state cookie in all cases. Run `pnpm test:e2e -- auth` until T012 passes.

- [X] T016 [US2] Keep OAuth `code` and `state` out of logs: `pino-http` logs `req.url`, and `redact` in `src/app.module.ts` covers headers only. Add a `serializers.req` to the `pinoHttp` options that replaces the query string of `/api/v1/auth/google/callback` with `?redacted`, keeping the existing `redact` entries. Test in `src/app.module.spec.ts` or a unit test of the serializer: a request URL `/api/v1/auth/google/callback?code=abc&state=xyz` is logged without `abc` or `xyz`.

**Checkpoint**: both sign-in methods work independently.

---

## Phase 5: User Story 3 - Email format check (P1)

**Goal**: the backend never accepts a badly formatted email and never restricts the domain. (The inline red message is frontend.)

**Independent Test**: sign-in with a malformed email returns 400 `VALIDATION_FAILED`; a valid email on any domain is accepted.

- [X] T017 [US3] Add to `test/auth.e2e-spec.ts`: `"not-an-email"` and an email longer than 254 characters → 400 `VALIDATION_FAILED`; `"User@Example.ORG"` with a correct password for `user@example.org` → 200 (trim and lower-case normalisation); a user on a non-company domain (`@e2e.test`) signs in with no domain restriction. If any case fails, fix `src/modules/auth/dto/sign-in.dto.ts`.

---

## Phase 6: User Story 4 - Signed-out notice and expiry (P2)

**Goal**: a session ended for any reason except logout, or idle for `SESSION_IDLE_DAYS`, yields 401 `SESSION_ENDED` so the frontend can sign the user out and show the notice (research R5). The links to WEB-14 and WEB-02 and the "Password updated" notice are frontend.

**Independent Test**: quickstart e2e case 9 and 10 pass; existing `test/app.e2e-spec.ts` still passes.

### Tests for User Story 4 (write first)

- [X] T018 [US4] Create `test/session.e2e-spec.ts` (separate file, so US4 can run in parallel with US2): session ended with `signed_out_by_admin`, `password_changed`, `password_reset`, `signed_out_by_user` → 401 `SESSION_ENDED` (every reason except `logout` shows the "You were signed out" notice, decided by the user, including `signed_out_by_user`); ended with `logout` → 401 without `SESSION_ENDED`; no cookie → 401 without `SESSION_ENDED`; `last_active_at` older than 7 days → 401 `SESSION_ENDED` and the row now has `ended_at` set and `end_reason = expired`; `last_active_at` 2 hours old → 200 and `last_active_at` refreshed; 10 minutes old → 200 and `last_active_at` unchanged.

### Implementation for User Story 4

- [X] T019 [US4] Edit `src/common/guards/session.guard.ts`: read `SESSION_IDLE_DAYS` from `ConfigService`; if the session is live but `lastActiveAt` is older than that, set `endedAt` and `endReason = expired` and throw 401 `SESSION_ENDED`; if the session is already ended with a reason other than `logout`, throw 401 with `code: 'SESSION_ENDED'`; otherwise, when `lastActiveAt` is more than 1 hour old, update it (and re-set the cookie `maxAge`). Keep the existing deactivated-user and ended-session rejection. First grep the existing e2e tests and callers for assertions on 401 bodies and update them if needed. Run `pnpm test:e2e` for the whole suite.

- [X] T018a [US4] (added after implementation, at the user's request; not on the card) `GET /auth/me`: `AuthController.me` and `AuthService.me` in `src/modules/auth/`, behind the global `SessionGuard`, returning the sign-in body shape (`user` + `next`) from an explicit `select`; e2e cases in `test/auth.e2e-spec.ts` (401 without a session, 200 with the user and no secrets, `verify-email` for an unverified user).

---

## Phase 7: User Story 5 - Show/hide password (P3)

No backend work: the eye button is a frontend behaviour. Nothing to implement in this repository.

---

## Phase 8: Polish & cross-cutting

- [X] T020 [P] Update `.claude/rules/testing.md`: the line "Sign in by creating a user with a session row ... until the auth endpoints exist; then prefer the real sign-in flow" now has its endpoints; keep the helper pattern for tests unrelated to auth and say that auth tests use `POST /auth/sign-in`.
- [X] T021 [P] Confirm Swagger JSON (`/api/docs-json` under `pnpm start:dev`) lists the three auth routes with their error responses, and that no response schema includes `passwordHash`.
- [X] T022 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `pnpm db:check`; all must exit 0. Report any check that could not run instead of calling it passed.
- [ ] T023 (automated cases 1 to 10 of the quickstart pass; the manual Google check and /create-pr are left) Walk through `specs/4/quickstart.md` (manual Google section only when credentials exist) and tick each case. Then use `/create-pr`; the PR title is the card name "Implement feature User Sign In" verbatim.

---

## Dependencies & execution order

- Phase 1 → Phase 2 → stories. T001 blocks T004 (parameters). T003 blocks T019 (`expired` enum value).
- US1 (T007 to T010) is the MVP. US2 needs T006 and `createSession`; it does not need US1 but shares `auth.service.ts` and `auth.controller.ts`, so run it after US1 or merge carefully.
- US3 only adds tests and depends on T008.
- US4 depends on T003 and touches a different file set, so it can run in parallel with US2 once Phase 2 is done.
- Polish last.

```text
T001 ─▶ T004 ─┐
T002 ─────────┤
T003 ─────────┼─▶ T006 ─▶ US1 (T007,T008 ║ T009,T010) ─▶ US2 ─▶ US3
T005 ─────────┘                         └──────────────▶ US4 (T018,T019)
```

## Parallel examples

- Setup: T002 and T003 together while T001 runs.
- Foundational: T004 and T005 together.
- US1: T007 (test) and T008 (DTO) together; T009 then T010 in order.
- US2: T011 and T013 together.
- Polish: T020 and T021 together.

## Implementation strategy

1. MVP: Phases 1, 2 and 3. Email + password sign-in with lockout, shippable alone.
2. Add US2 (Google), then US3 tests, then US4 (expiry and notice).
3. Polish and PR.

Open items that can still change tasks: the 7-day idle value needs client confirmation (research R5); Google credentials from the client (confirmation C-15) are needed only for the manual check in T023.
