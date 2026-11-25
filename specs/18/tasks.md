---

description: "Task list for #18 Implement feature Forgot Password (backend)"
---

# Tasks: #18 Implement feature Forgot Password

**Input**: `specs/18/` (plan.md, spec.md, research.md, data-model.md, contracts/auth-password-reset.md, quickstart.md)

**Prerequisites**: worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`). The project owner confirmed P1 to P3 (plan.md) and that the card includes the backend (2026-11-25).

**Tests**: included, because `.claude/rules/testing.md` requires an e2e test per endpoint and a unit test for logic. Write each story's tests first and watch them fail.

**Scope**: backend only. Pure UI criteria (opening WEB-14/WEB-15, button states, live checklist, sign-in notice) belong to the frontend repository (same card).

**Stories**: US1 to US3 are the three Acceptance Criteria sections of spec.md. The card sets no priorities; those below are proposed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files and no dependency on an unfinished task.
- Tasks that edit the same file are never `[P]` against each other.
- Commit subject: `<type>(auth): #18 <Imperative summary>`

## Phase 1: Setup

- [X] T001 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm db:check` on the untouched branch and note any failure that is already there. No migration, schema edit, env var or dependency is expected; if one turns out to be needed, STOP and ask.

---

## Phase 2: Foundational (blocks all user stories)

- [X] T002 Create `src/modules/auth/send-cooldown.service.ts` with `claim(scope: AuthThrottleScope, email, now = new Date())` by moving `claim`, `restart`, `findRow`, `cooldownStart` and `RESEND_SECONDS` out of `src/modules/auth/sign-up/email-verification.service.ts` with their comments and race guards unchanged (research R1). `EmailVerificationService` takes it as a dependency and keeps `claim(email, now)` as a one-line call with scope `verify_email`, so its callers and their specs do not change; its `attempt` keeps reading the row. Provide it in `src/modules/auth/auth.module.ts`.
- [X] T003 In `src/modules/auth/sign-up/email-verification.service.spec.ts` only change the construction: pass a real `SendCooldownService` over the same fake Prisma. Every existing case passes unedited and covers the moved code. Run `test/sign-up.e2e-spec.ts` too. Needs T002.
- [X] T004 [P] Add `sendResetLink(to, token)` and `sendGoogleSignInNotice(to)` to `src/modules/email/email.service.ts` with the texts of the contract; links use `APP_ORIGIN` from `ConfigService` and the token goes in the fragment (`/reset-password#token=`). Both go through the existing private `send`. In `src/modules/email/email.service.spec.ts` test that the reset email holds the link, the notice holds no token, and a failed send logs neither the address nor the token.
- [X] T005 Create `test/password-reset.e2e-spec.ts` with the app built as in `test/sign-up.e2e-spec.ts`: users at `@reset.e2e.test`, cleanup of its own users and only its own throttle keys (`reset_email`, `sign_in`, `verify_email`), `EmailService` overridden by a fake recording reset links, notices and verification codes. Collect background tasks with `setBackgroundRunner` and await them before every assertion on emails or tokens. Helpers: make a user, insert a token row for a known token, age `lastSentAt`. Needs T004.

**Checkpoint**: existing tests pass; no endpoint yet.

---

## Phase 3: User Story 1 - Request password reset (P1)

**Goal**: `POST /api/v1/auth/forgot-password` per [contracts/auth-password-reset.md](./contracts/auth-password-reset.md).

**Independent Test**: a request for a password account stores one token hash and emails one link; every other email gets the same answer.

### Tests (write first)

- [X] T006 [US1] In `test/password-reset.e2e-spec.ts`: verified account → 200 `{ sent: true }`, no cookie, one link emailed, one row with only the SHA-256 hash and `expiresAt` = creation + 30 minutes; unverified and Google-linked password accounts → a link too; Google-only → one notice, no row; unknown and deactivated → nothing sent, no row; all of these with the same status and body; email with spaces and capitals → same account and same window; again within 60 s → 200, nothing sent, the earlier row still live, also for unknown and Google-only emails; after 60 s → new link, the old row voided; two parallel requests → both 200, one email, one live row; (a failing token write is in the unit spec) invalid email, missing email, unknown field → 400 `VALIDATION_FAILED`; no CSRF → 403 `CSRF_INVALID`; the `verify_email` window does not block `reset_email`. Needs T005.

### Implementation

- [X] T007 [P] [US1] Create `src/modules/auth/dto/forgot-password.dto.ts`: `class ForgotPasswordDto extends EmailDto {}`.
- [X] T008 [US1] Create `src/modules/auth/password-reset/password-reset.service.ts` with `forgotPassword(dto)`: `claim('reset_email', dto.email)`, refused → return; look the user up (`id`, `email`, `passwordHash`, `deactivatedAt`); absent or deactivated → return; the rest inside `runInBackground` (research R2), catching every error and logging the user id and error class only. No password → `sendGoogleSignInNotice`. Password → void the live row (`usedAt` and `voidedAt` null), create one with `newSessionToken()` / `hashSessionToken()` and `expiresAt` = now + 30 minutes; a unique conflict (`isUniqueConflict`) sends nothing; then `sendResetLink`. A failing runner must not fail the request. Always return `{ sent: true }`. Provide it in `src/modules/auth/auth.module.ts`. Needs T002, T004, T007.
- [X] T009 [US1] Add `@Public()` `@Post('forgot-password')` `@HttpCode(200)` with a why-comment and `@ApiResponse` for 200, 400, 403 to `src/modules/auth/auth.controller.ts`; T006 passes. Needs T006, T008.

**Checkpoint**: the link arrives in Mailpit.

---

## Phase 4: User Story 2 - Validate reset link (P1)

**Goal**: `POST /api/v1/auth/reset-password/check`.

**Independent Test**: insert token rows in the database; only the valid one returns the email.

### Tests (write first)

- [X] T010 [US2] In `test/password-reset.e2e-spec.ts`: valid link → 200 `{ email }` exactly, and again 200 (not used up); unknown, empty, malformed and very long tokens, expired, used, voided, deactivated account, account whose password was dropped → 400 `RESET_LINK_INVALID` with identical bodies; a missing or non-string token → 400 `VALIDATION_FAILED`; no CSRF → 403 `CSRF_INVALID`. Needs T005.

### Implementation

- [X] T011 [P] [US2] Create `src/modules/auth/dto/check-reset-link.dto.ts`: `token` with `@IsString()` only, and a why-comment for the missing `@MaxLength` (decision #46: a malformed link gets the link error; the request body limit bounds it).
- [X] T012 [US2] In `src/modules/auth/password-reset/password-reset.service.ts` add one private lookup of a valid link by `hashSessionToken(token)` (unused, unvoided, `expiresAt` in the future, user active with a password), throwing 400 `RESET_LINK_INVALID` with the contract text, and `checkLink(dto)` returning only `{ email }`. Add `@Public()` `@Post('reset-password/check')` `@HttpCode(200)` with a why-comment and `@ApiResponse` for 200, 400, 403 to `src/modules/auth/auth.controller.ts`; T010 passes. Needs T008, T010, T011.

**Checkpoint**: WEB-15 can show the form or the expired state.

---

## Phase 5: User Story 3 - Complete password reset (P1) 🎯 MVP ends here

**Goal**: `POST /api/v1/auth/reset-password`.

**Independent Test**: insert a token row; a reset changes the password, ends every session and uses the link once.

### Tests (write first)

- [X] T013 [US3] In `test/password-reset.e2e-spec.ts`: reset → 200 `{ next: "sign-in" }`, no session cookie, the new password signs in and the old one answers 401; two open sessions → `GET /auth/me` answers 401 `SESSION_ENDED` for both, another user's session and an already ended one are untouched; a locked email → signs in at once; unverified account → `emailVerifiedAt` still null and sign-in says `verify-email`; the same new password as the old → 200; every invalid link of T010 → 400 `RESET_LINK_INVALID` and password, sessions and lock unchanged; same link again → 400; link voided by a newer request → 400; under 8 characters, no letter, no number, over 128, containing the email name in another letter case → 400 `VALIDATION_FAILED` with `details`, and the link still works afterwards; two parallel resets with different passwords → one 200, one 400, and the winner's password signs in; account deactivated, and password dropped, between the lookup and the batch (spy on `PasswordService.hash`) → 400 and nothing changed; `password_hash` and dates read back through Prisma as valid values, dates as `Date`; no CSRF → 403. Needs T005.

### Implementation

- [X] T014 [P] [US3] Create `src/modules/auth/dto/reset-password.dto.ts`: extends `CheckResetLinkDto`, plus `@IsNewPassword() password`, with a one-line comment that the email-name rule runs in the service (no `email` field here). Needs T011.
- [X] T015 [US3] Add `resetPassword(dto)` to `src/modules/auth/password-reset/password-reset.service.ts` (research R4, R5): look the link up (T012); `failedPasswordRules(password, user.email)` not empty → `BadRequestException` whose `message` is that list (the filter maps it to `VALIDATION_FAILED`); hash; one `getBindings().DB.batch` with bound parameters, in this order: set `users.password_hash` and `updated_at`; end open `user_sessions` (`ended_at`, `end_reason = 'password_reset'`, `updated_at`); delete the `auth_throttles` row of `throttleKey('sign_in', email)`; set `password_reset_tokens.used_at` and `updated_at`. All four statements require that the token row is unused, unvoided and unexpired and its user is active with a password. Dates as `toISOString()` with `Z` replaced by `+00:00`. Last statement's `meta.changes` not 1 → `RESET_LINK_INVALID`. Return `{ next: 'sign-in' }`. One comment on why the link is marked used last. Needs T012, T014.
- [X] T016 [US3] Add `@Public()` `@Post('reset-password')` `@HttpCode(200)` with a why-comment and `@ApiResponse` for 200, 400, 403 to `src/modules/auth/auth.controller.ts`; T013 passes. Needs T013, T015.

**Checkpoint**: MVP. A person can get back into the account.

---

## Phase 6: Polish and cross-cutting

- [X] T017 Add a unit test `src/modules/auth/password-reset/password-reset.service.spec.ts` for what e2e cannot reach: a background failure logs the user id and error class but no email or token, and a runner that throws does not fail the request; a claim is made before the user is looked up. Needs T015.
- [X] T018 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm db:check` and fix what fails. Needs T017.
- [X] T019 Run the scenarios of `specs/18/quickstart.md` against `pnpm start:dev` with Mailpit, including the nested background send (research R2). Record in this file what was run and what was not. Needs T018. (2026-11-25: scenarios 1, 4 (used link only), 6 (email name), 7 with one session, and 2 without the deactivated case, run by hand with `wrangler dev` and Mailpit; the nested background send delivered both emails, and no token or email appeared in the log. The rest is covered by `test/password-reset.e2e-spec.ts` only.)
- [X] T020 Review the diff with the `code-reviewer` and `security-auditor` definitions in `.claude/agents/`, when the user asks for it; fix Critical and High findings and record all in `specs/18/plan.md`. Needs T018.
- [ ] T021 After the staging deploy: check that both emails arrive and that a reset does not hit error 1102 (CPU); record the result in `specs/18/research.md`. Needs the merge.
- [X] T022 Fix the review findings R1 and R2 of `specs/18/plan.md` in `src/modules/auth/session/session.service.ts` and `src/modules/auth/sign-up/sign-up.service.ts`, tests first (`test/password-reset.e2e-spec.ts`).

---

## Dependencies

- T001 → Foundational (T002 to T005) → stories.
- T003 needs T002; T005 needs T004; T004 is independent of T002.
- US1 → US2 → US3: they share the service, controller and e2e files, and US3 uses the lookup of US2. Each is testable alone because tests insert their own token rows.
- Polish comes last; T021 is after the merge.

## Parallel examples

- Foundational: T004 with T002.
- US1: T007 (DTO) with T006 (tests).
- US2: T011 (DTO) with T010 (tests).
- US3: T014 (DTO) with T013 (tests).

## Implementation strategy

1. **MVP**: Phases 1 to 5. A link nobody can use has no value, so US1 to US3 ship together in one PR.
2. Polish, then the PR into `develop`.
