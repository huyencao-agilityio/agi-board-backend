---

description: "Task list for #22 Profile and Account Settings (backend)"
---

# Tasks: #22 Implement feature Profile and Account Settings (backend)

**Input**: Design documents from `specs/22/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D9), data-model.md, contracts/users-me.md, contracts/auth-account.md, quickstart.md

**Tests**: Required. `.claude/rules/testing.md` asks e2e for every new endpoint (happy path, 401 without session, 400 invalid input, 404 where a resource id is involved) and unit tests for pure logic.

**Scope**: Backend only (card AC 1–3 + clarifications Q1–Q5). The settings page belongs to the frontend repo. No schema change, no migration, no new dependency.

**User stories** (grouped from the card's acceptance criteria):

- **US1 (P1)**: View and edit profile: `GET /users/me`, `PATCH /users/me` (AC 1).
- **US2 (P2)**: Avatar: upload (multipart), view, remove; old object deleted (AC 4, Q2, Q5).
- **US3 (P2)**: Change password with current-password check, rate limit, other sessions signed out (AC 2, Q4).
- **US4 (P3)**: Active sessions: list, sign out one, sign out all others (AC 3, Q1, Q3).

US2 needs US1's module and profile; US3 and US4 are independent of US1/US2 and of each other except that both add routes to `src/modules/auth/auth.controller.ts` and methods to `account-security.service.ts` (do them one after the other).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

## Path Conventions

Repo root: `/home/huyencao/Documents/training/agi-board/agi-board-backend-22/`. Source in `src/`, e2e in `test/`.

---

## Phase 1: Setup

- [X] T001 Copy `.env` and `.dev.vars` from the main checkout into `/home/huyencao/Documents/training/agi-board/agi-board-backend-22/` if they exist there (the user does this; the guard hook blocks agents from reading `.env`), then confirm the baseline: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all pass before any change
- [X] T002 Spike (research D2 "to verify first"): on `pnpm start:dev`, in a temporary Nest route, confirm that (a) reading the Express `req` with `for await (const chunk of req)` collects the full multipart body inside the Worker, and (b) `await new Response(buffer, { headers: { 'content-type': req.get('content-type') } }).formData()` parses it and `form.get('file')` is a `File` with correct `size` and bytes. Also check `Buffer.from(await (await IMAGES.get(key)).arrayBuffer())` returns the stored bytes (for T018). Use a temporary route or a throwaway script under the scratchpad; do not commit it. If it fails, stop and report to the user before continuing (fallback in research D2 alternatives)

---

## Phase 2: Foundational

**Purpose**: Shared pieces that US2 and US3 need.

- [X] T003 Fix `src/common/filters/all-exceptions.filter.ts` (research D3): before the final 500, treat a non-`HttpException` error that has `expose === true` and a numeric `status` in 400–499 (body-parser errors, e.g. `type: 'entity.too.large'` → 413) as that status, with `code = HttpStatus[status]` (413 → `PAYLOAD_TOO_LARGE`) and a generic `message` (never the parser's own message). Keep the existing branches unchanged
- [X] T004 [P] Unit test for T003 in `src/common/filters/all-exceptions.filter.spec.ts` (create): a fake body-parser error `{ expose: true, status: 413, type: 'entity.too.large' }` → 413 `PAYLOAD_TOO_LARGE`; `{ expose: false, status: 413 }` → 500; a plain `Error` → 500
- [X] T005 Give `SignInThrottleService` a scope (research D7) in `src/modules/auth/sign-in/sign-in-throttle.service.ts`: `attempt(subject, scope: 'sign_in' | 'change_password' = 'sign_in', now = new Date())`, `recordFailure(subject, scope = 'sign_in', now = new Date())`, `reset(subject, scope = 'sign_in')`; `key()` uses `throttleKey(scope, subject)`. Behaviour for `sign_in` stays identical; update the class doc comment (subject = lower-cased email for sign-in, user id for change password). Update `src/modules/auth/sign-in/sign-in-throttle.service.spec.ts` for the new argument order wherever it passes `now`, and add one case showing `change_password` rows use their own key (a locked `change_password` subject does not lock `sign_in`). `src/modules/auth/sign-in/sign-in.service.ts` callers stay `attempt(email)` etc.

**Checkpoint**: `pnpm typecheck && pnpm test` clean.

---

## Phase 3: User Story 1 - View and edit profile (Priority: P1) 🎯 MVP

**Goal**: The signed-in user reads name, email, avatar URL, password and Google status, and edits the name.

**Independent Test**: `GET /users/me` returns the profile shape of contracts/users-me.md; `PATCH /users/me { fullName: "  New  " }` returns `fullName: "New"` and `GET /auth/me` shows it.

### Tests for User Story 1

- [X] T006 [P] [US1] E2E in `test/profile.e2e-spec.ts` (create; sign in with the `signedIn()` helper pattern from `test/app.e2e-spec.ts`, users under `@profile.e2e.test`, clean own rows in `beforeEach`/`afterAll`): `GET /users/me` 200 with `{ id, email, fullName, avatarUrl: null, hasPassword, googleLinked }` and no other keys (password account → `hasPassword: true, googleLinked: false`; Google-only user with `googleSubject` set and `passwordHash` null → `hasPassword: false, googleLinked: true`); 401 without session. `PATCH /users/me` 200 with trimmed name and the change visible in `GET /auth/me`; 400 `VALIDATION_FAILED` for `"   "`, missing `fullName`, non-string, and an unknown field (`email`); 401 without session; 403 `CSRF_INVALID` without the CSRF header

### Implementation for User Story 1

- [X] T007 [P] [US1] Create `src/modules/users/dto/update-profile.dto.ts`: `UpdateProfileDto { fullName!: string }` with `@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))`, `@IsString()`, `@IsNotEmpty()` (DB CHECK `trim(full_name) <> ''`; no max length, same as `SignUpDto`). Swagger `@ApiProperty`
- [X] T008 [US1] Create `src/modules/users/profile.service.ts`: `ProfileService` with `getProfile(userId)` and `updateName(userId, fullName)`, both returning `{ id, email, fullName, avatarUrl, hasPassword, googleLinked }` from an explicit `select` (`id, email, fullName, avatarObjectKey, passwordHash, googleSubject`), mapping `hasPassword = passwordHash !== null`, `googleLinked = googleSubject !== null` and never returning the hash or subject. Export a pure `avatarUrl(key: string | null): string | null` → `null` or `/api/v1/users/me/avatar?v=<last path segment of key>` (research D4). Map the DTO field explicitly into `data: { fullName }`
- [X] T009 [US1] Unit test (after T008) `src/modules/users/profile.service.spec.ts`: `avatarUrl(null)` → `null`, `avatarUrl('avatars/u1/abc')` → `/api/v1/users/me/avatar?v=abc`; `getProfile` maps booleans and omits `passwordHash`/`googleSubject` (Prisma mocked)
- [X] T010 [US1] Create `src/modules/users/users.controller.ts`: `@ApiTags('users') @Controller('users/me')`, `@Get()` → `profile.getProfile(user.id)`, `@Patch()` with `UpdateProfileDto` → `profile.updateName(user.id, dto.fullName)`; user from `@CurrentUser()`; `@ApiResponse` for 400/401
- [X] T011 [US1] Create `src/modules/users/users.module.ts` (controller `UsersController`, provider `ProfileService`) and add `UsersModule` to `imports` in `src/app.module.ts`

**Checkpoint**: `pnpm test:e2e -- profile` green for US1 cases.

---

## Phase 4: User Story 2 - Avatar upload, view, remove (Priority: P2)

**Goal**: The user uploads a JPEG/JPG, PNG, WebP or GIF up to 5 MB as `multipart/form-data` field `file`, sees it through `avatarUrl`, and can remove it; the previous object is deleted from R2.

**Independent Test**: upload a small PNG → 200 with `avatarUrl`; `GET` it → same bytes; upload again → first object gone; `DELETE` → `avatarUrl: null`, object gone.

### Tests for User Story 2

- [X] T012 [P] [US2] Unit test `src/modules/users/image-type.spec.ts` (`it.each` table) for `detectImageType(bytes: Uint8Array)`: JPEG `FF D8 FF ..` → `image/jpeg`; PNG `89 50 4E 47 0D 0A 1A 0A` → `image/png`; `GIF87a`/`GIF89a` → `image/gif`; `RIFF????WEBP` → `image/webp`; `RIFF????AVI ` → `null`; text, PDF `%PDF`, empty and 2-byte inputs → `null`
- [X] T013 [P] [US2] E2E cases in `test/profile.e2e-spec.ts` (use supertest `.attach('file', buffer, { filename, contentType })`; small valid images as inline byte buffers; read and check objects through `getBindings().IMAGES`): upload PNG → 200, `avatarUrl` set, object exists with `httpMetadata.contentType = 'image/png'`; `GET avatarUrl` → 200, same bytes, `Content-Type: image/png`, `Cross-Origin-Resource-Policy: same-site`, `Cache-Control` contains `immutable`; second upload → new `avatarUrl`, first object deleted; PNG bytes in a part typed `image/jpeg` named `a.jpg` → stored as `image/png`; text bytes typed `image/png` → 415 `UNSUPPORTED_IMAGE_TYPE` and avatar unchanged; multipart without `file`, and a JSON body → 400 `VALIDATION_FAILED`; file of 5 MB + 1 byte → 413 `PAYLOAD_TOO_LARGE` and avatar unchanged; `DELETE /users/me/avatar` → 204, `avatarUrl: null`, object deleted, `GET /users/me/avatar` → 404 `AVATAR_NOT_FOUND`; second `DELETE` → 204; 401 without session and 403 without CSRF for `PUT` and `DELETE`. Also one case for T003: a JSON body over 100 kB to `PATCH /users/me` → 413, not 500. Delete created R2 objects in `afterAll`

### Implementation for User Story 2

- [X] T014 [P] [US2] Create `src/modules/users/image-type.ts`: pure `detectImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null` using the signatures in research D2; export `AVATAR_MAX_BYTES = 5 * 1024 * 1024`
- [X] T015 [US2] Create `src/modules/users/read-body.ts`: `readBody(stream: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer>` that collects chunks with `for await`, keeps a running byte total and throws `PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: ... })` as soon as the total passes `limit`, without collecting further chunks; export `AVATAR_BODY_LIMIT = AVATAR_MAX_BYTES + 64 * 1024` with a one-line why-comment (room for the multipart boundary and part headers; research D2). Do not import `express` or `body-parser` (not direct dependencies). Unit test `src/modules/users/read-body.spec.ts` with an async generator: under the limit → concatenated bytes; exactly the limit → OK; limit + 1 → 413 and the generator is not read to the end
- [X] T016 [US2] Create `src/modules/users/avatar.service.ts` `AvatarService` (inject `PrismaService`, `ProfileService`; `Logger`), using `getBindings().IMAGES`:
  - `upload(userId, req: Request)`: `req.get('content-type')` must start with `multipart/form-data`, else 400 `VALIDATION_FAILED` (checked before reading the body); `body = await readBody(req, AVATAR_BODY_LIMIT)` (413 when over); empty body → 400 `VALIDATION_FAILED`; parse with `new Response(body, { headers: { 'content-type': contentType } }).formData()` (parse error → 400 `VALIDATION_FAILED`); `form.get('file')` must be a `File` with `size > 0` (else 400); `size > AVATAR_MAX_BYTES` → 413 `PAYLOAD_TOO_LARGE`; `detectImageType` of its bytes null → 415 `UNSUPPORTED_IMAGE_TYPE`. Then (research D5): read the old `avatarObjectKey`; `newKey = avatars/<userId>/<crypto.randomUUID()>`; `IMAGES.put(newKey, bytes, { httpMetadata: { contentType: detected } })`; update `avatarObjectKey = newKey` (on failure: best-effort delete `newKey`, rethrow); then best-effort delete the old key; return `profile.getProfile(userId)`
  - `remove(userId)`: read old key; if null return; set `avatarObjectKey = null`; best-effort delete old key
  - `get(userId)`: key null or `IMAGES.get(key)` null → 404 `AVATAR_NOT_FOUND`; return `{ body: Buffer.from(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType }` (≤ 5 MB, so reading it whole is fine; add `// shortcut: reads the whole image into memory, stream it if larger images are ever served`)
  - Best-effort delete = `try { await IMAGES.delete(key) } catch (err) { logger.warn(...) }` logging only user id, key and `err.name` (no personal data). Add the `shortcut:` comment from research D5 about parallel uploads leaving an orphan object
  - Error bodies use the shape `{ code, message }` as in other services
- [X] T017 [US2] Unit test (after T016) `src/modules/users/avatar.service.spec.ts` (Prisma and an in-memory fake `IMAGES` via `setBindings`): order put → update → delete old; failed old-key delete is logged and `upload` still resolves; failed DB update deletes the new object and rethrows; `remove` with no avatar does not touch R2; size and type errors happen before any `put`
- [X] T018 [US2] Add avatar routes to `src/modules/users/users.controller.ts`: `@Put('avatar')` reads `@Req() req` and calls `avatar.upload(user.id, req)` (200, `@HttpCode(200)`, `@ApiConsumes('multipart/form-data')`, `@ApiBody` with a binary `file` field); `@Delete('avatar') @HttpCode(204)` → `avatar.remove(user.id)`; `@Get('avatar')` with `@Res({ passthrough: true })` setting `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: same-site` and returning `new StreamableFile(body)` from the Buffer of `avatar.get()` (no `Readable.fromWeb`). `@ApiResponse` for 400/401/404/413/415. Register `AvatarService` in `src/modules/users/users.module.ts`

**Checkpoint**: `pnpm test && pnpm test:e2e -- profile` green.

---

## Phase 5: User Story 3 - Change password (Priority: P2)

**Goal**: An account with a password changes it after verifying the current one; other sessions are signed out, the current one stays; 5 wrong current passwords in 15 minutes → 429 without locking sign-in.

**Independent Test**: two sessions; change password from session A → 204; B → 401 `SESSION_ENDED`; A still works; sign-in with the new password works.

### Tests for User Story 3

- [X] T019 [P] [US3] E2E in `test/account-security.e2e-spec.ts` (create; real `POST /auth/sign-in` for two sessions, as in `test/auth.e2e-spec.ts`; users under `@account.e2e.test`; clean own rows incl. `auth_throttles` with scope `change_password`): happy path → 204, other session → 401 `SESSION_ENDED`, current session → `GET /auth/me` 200, old password sign-in → 401, new password sign-in → 200, `user_sessions.end_reason = 'password_changed'` for the other one; wrong current → 400 `CURRENT_PASSWORD_INCORRECT`, hash unchanged, no session ended; 5 wrong then a 6th (even with the right password) → 429 `CHANGE_PASSWORD_LOCKED`, and `POST /auth/sign-in` with the current password still 200; weak new password (`"short1"`, no number, contains the email name) → 400 `VALIDATION_FAILED` with `details`; Google-only user (session row, `passwordHash` null) → 400 `PASSWORD_NOT_SET`; missing fields / unknown field → 400 `VALIDATION_FAILED`; 401 without session; 403 without CSRF

### Implementation for User Story 3

- [X] T020 [P] [US3] Create `src/modules/auth/dto/change-password.dto.ts`: `currentPassword` and `newPassword`, each `@IsString() @IsNotEmpty()` (no trim; new-password rules are checked in the service with the user's email, like reset)
- [X] T021 [US3] Create `src/modules/auth/account/account-security.service.ts` `AccountSecurityService` (inject `PrismaService`, `PasswordService`, `SignInThrottleService`) with `changePassword(user: SessionUser, dto)` per research D6, in this order: load with `passwordUserSelect`; `passwordHash` null → 400 `PASSWORD_NOT_SET`; `throttle.attempt(user.id, 'change_password')` false → 429 `CHANGE_PASSWORD_LOCKED`; `passwords.verify` false → `throttle.recordFailure(user.id, 'change_password')`, 400 `CURRENT_PASSWORD_INCORRECT`; `failedPasswordRules(newPassword, email)` non-empty → `BadRequestException(failed)` (becomes `VALIDATION_FAILED`); hash; one `getBindings().DB.batch` with the three statements of research D6 (users update guarded by `password_hash = verifiedHash`; end other live sessions `id <> user.sessionId` with `end_reason = 'password_changed'` guarded by `EXISTS (users row has the new hash)`; delete the `change_password` throttle row via `throttleKey('change_password', user.id)`); first statement `meta.changes !== 1` → 400 `CURRENT_PASSWORD_INCORRECT`. Dates in raw SQL as in `password-reset.service.ts` (`toISOString().replace('Z', '+00:00')`); bound parameters only
- [X] T022 [P] [US3] Unit test `src/modules/auth/account/account-security.service.spec.ts` for `changePassword`: order (attempt before verify, like `sign-in.service.spec.ts`); locked → 429 and no verify; wrong → `recordFailure` and 400; rules failing → 400 with messages and no batch; Google-only → 400 `PASSWORD_NOT_SET` and no attempt counted; batch first statement 0 changes → 400
- [X] T023 [US3] Add to `src/modules/auth/auth.controller.ts`: `@Post('change-password') @HttpCode(204)` with `ChangePasswordDto` → `accountSecurity.changePassword(user, dto)`; `@ApiResponse` 204/400/401/403/429. Register `AccountSecurityService` in `src/modules/auth/auth.module.ts`

**Checkpoint**: `pnpm test && pnpm test:e2e -- account-security` green.

---

## Phase 6: User Story 4 - Active sessions (Priority: P3)

**Goal**: The user lists live sessions (raw user agent, created/last active, current marked) and signs out one other session or all others.

**Independent Test**: two sessions; `GET /auth/sessions` → 2 items, one `isCurrent`; `DELETE /auth/sessions/:other` → 204, that session → 401 `SESSION_ENDED`.

### Tests for User Story 4

- [X] T024 [P] [US4] E2E cases in `test/account-security.e2e-spec.ts`: `GET /auth/sessions` with 2 live + 1 ended + 1 idle past `SESSION_IDLE_DAYS` → exactly the 2 live, sorted by `lastActiveAt` desc, each `{ id, userAgent, createdAt, lastActiveAt, isCurrent }` only (no `ipAddress`), exactly one `isCurrent: true`; another user's sessions never listed; `DELETE /auth/sessions/:otherId` → 204, `end_reason = 'signed_out_by_user'`, that cookie → 401 `SESSION_ENDED`; own session id → 400 `CURRENT_SESSION`; another user's session id, an ended one and a random UUID → 404 `SESSION_NOT_FOUND`; non-UUID → 400 `VALIDATION_FAILED`; `DELETE /auth/sessions` → 204, all others ended, current still 200, and 204 again when none are left; 401 without session and 403 without CSRF for both `DELETE`s

### Implementation for User Story 4

- [X] T025 [US4] Add to `src/modules/auth/account/account-security.service.ts` (inject `ConfigService<Env, true>` for `SESSION_IDLE_DAYS`, `DAY_MS` from `src/common/session-cookie.ts`):
  - `listSessions(user)`: `userSession.findMany({ where: { userId, endedAt: null, lastActiveAt: { gt: now - idleDays } }, orderBy: { lastActiveAt: 'desc' }, select: { id, userAgent, createdAt, lastActiveAt } })` → `{ items: [...each, isCurrent: id === user.sessionId] }`. Comment: not paginated on purpose (research D8)
  - `endSession(user, sessionId)`: `sessionId === user.sessionId` → 400 `CURRENT_SESSION`; `updateMany({ where: { id: sessionId, userId: user.id, endedAt: null }, data: { endedAt: now, endReason: 'signed_out_by_user' } })` count 0 → 404 `SESSION_NOT_FOUND`
  - `endOtherSessions(user)`: `updateMany({ where: { userId: user.id, endedAt: null, id: { not: user.sessionId } }, data: { endedAt: now, endReason: 'signed_out_by_user' } })`
- [X] T026 [P] [US4] Unit tests in `src/modules/auth/account/account-security.service.spec.ts`: `isCurrent` mapping and idle cutoff in the query; `endSession` current id → 400 without a write; count 0 → 404; `endOtherSessions` excludes the current id
- [X] T027 [US4] Add to `src/modules/auth/auth.controller.ts`: `@Get('sessions')` → `listSessions(user)`; `@Delete('sessions/:sessionId') @HttpCode(204)` with `@Param('sessionId', ParseUUIDPipe)` → `endSession`; `@Delete('sessions') @HttpCode(204)` → `endOtherSessions`. `@ApiResponse` per contracts/auth-account.md

**Checkpoint**: `pnpm test && pnpm test:e2e -- account-security` green.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T028 [P] Add one line to `.claude/rules/nestjs.md` under "Lists and pagination": `GET /auth/sessions` is not paginated (a user's live sessions are few; specs/22/research.md D8)
- [X] T029 [P] Add one line to `.claude/rules/security.md` under "Personal data": avatars are served only to their owner through `GET /users/me/avatar`; other users' avatars need a permission rule (specs/22/research.md D4)
- [X] T030 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm db:check`; all must exit 0 (`db:check`: no schema change). Then run the `code-reviewer` agent and the `security-auditor` agent (change touches controllers, DTOs, Prisma queries, the filter and setup); fix Critical and High findings before `/create-pr`. Put in the PR's Risk section the staging check from research D6: after deploy, change a password on staging and watch for Cloudflare error 1102 (2 × PBKDF2 per request); if it appears, lower `PASSWORD_PBKDF2_ITERATIONS` or move to the paid plan

---

## Phase 8: Follow-up (PO decision 2026-11-26)

- [X] T031 [US3] Refuse a new password equal to the current one in `src/modules/auth/account/account-security.service.ts` (`SAME_AS_CURRENT` added to the rule list, before hashing); unit case in `account-security.service.spec.ts`, e2e case in `test/account-security.e2e-spec.ts`; spec, research D6, contract and quickstart updated

- [X] T032 [US2] Serve `GET /users/me/avatar` only for the current `?v=` (404 otherwise) in `src/modules/users/avatar.service.ts` / `users.controller.ts`, with the shared `avatarVersion()` in `profile.service.ts`; unit and e2e cases; research D4 (also the same-site requirement for the cookie on `<img>`), contract and quickstart updated

- [X] T033 [US2] Add `avatarUrl` to `user` in sign-in results (`/auth/me`, sign-in, verify-email, Google) via `src/modules/auth/session/session.service.ts` and `signedInUserSelect`; move `avatarUrl()`/`avatarVersion()` to `src/common/avatar-url.ts`; update `auth`/`sign-up` e2e shapes, add a `/auth/me` case in `test/profile.e2e-spec.ts`; research D11

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T005)** → stories.
- **US1 (T006–T011)**: after Foundational. MVP.
- **US2 (T012–T018)**: after US1 (needs `UsersModule`, `ProfileService`, `avatarUrl`) and T003 (413 mapping).
- **US3 (T019–T023)**: after T005; independent of US1/US2.
- **US4 (T024–T027)**: after US3 or alongside it in a different order, but T025/T027 edit the same files as T021/T023, so not in parallel with them.
- **Polish (T028–T030)**: after all stories.

Within a story: tests first (expect them to fail), then DTO/pure helpers, service, controller.

## Parallel Example

```text
# After Foundational:
US1: T006 (e2e) | T007 (DTO) | T009 (unit, after T008)
US3: T019 (e2e) | T020 (DTO)          # different files from US1, can run alongside US1

# US2:
T012 (image-type spec) | T013 (e2e) | T014 (image-type.ts) | T015 (read-body.ts, after T014 for AVATAR_MAX_BYTES)
```

## Implementation Strategy

1. T001–T005, then US1 → check: profile read/edit works end to end (MVP).
2. US2 (avatar) → biggest risk (multipart on Workers, R2); T002 de-risks it up front.
3. US3, then US4 (shared files).
4. Polish, full checks, reviewers, `/create-pr`.
