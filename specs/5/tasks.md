---

description: "Task list for #5 Implement feature User Sign Up (backend)"
---

# Tasks: #5 Implement feature User Sign Up

**Input**: `specs/5/` (plan.md, spec.md, research.md, data-model.md, contracts/auth-sign-up.md, quickstart.md)

**Prerequisites**: worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`).

**Tests**: included, because `.claude/rules/testing.md` requires an e2e test per endpoint and a unit test for pure logic. Write each story's tests first and watch them fail.

**Scope**: backend only. Pure UI criteria (inline errors, disabled button, spinner, countdown, navigation) belong to the frontend repository (same card).

**Stories**: US1 to US4 are the four Acceptance Criteria sections of spec.md. The card sets no priorities; those below are proposed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files and no dependency on an unfinished task.
- Tasks that edit the same file are never `[P]` against each other.
- Commit subject: `<type>(auth): #5 <Imperative summary>`

## Phase 1: Setup

- [X] T001 [P] Add `verify_email` to `enum AuthThrottleScope` in `prisma/schema/enums.prisma`, run `pnpm prisma generate`, then `pnpm db:check`. It must report no diff; if it does, STOP and ask.
- [X] T002 [P] Add `EMAIL_API_KEY` (string, min 1) and `EMAIL_FROM` (string, min 1) to `envSchema` in `src/config/env.ts`: optional outside production, required when `NODE_ENV === 'production'` (extend the existing `superRefine` list). Cover both, and update the existing "requires the Google variables in production" case so it still passes, in `src/config/env.spec.ts`. In `.env.example` replace `SMTP_HOST`/`SMTP_PORT` (unused) with commented `EMAIL_API_KEY`/`EMAIL_FROM`. In `README.md` replace "Runtime secrets (none yet)" with the real list. Do not invent a sender address for `wrangler.jsonc` (see T021).
- [X] T003 [P] Add a background-task hook to `src/cloudflare.ts`: `setBackgroundRunner(run)` and `runInBackground(promise)`. `edge/src/index.mjs` sets it to `waitUntil` from `cloudflare:workers` before the app starts; (done without a collector in `test/setup/bindings.ts`: e2e tests replace `EmailService`, the only user of the hook). Never let a rejected promise go unhandled.

---

## Phase 2: Foundational (blocks all user stories)

- [X] T004 [P] Create `src/modules/auth/password-rules.ts` with a pure function returning the failed rules of `(password, email)`, plus a class-validator decorator that reports each failed rule as its own message. Rules: "8 to 128 characters, at least one letter and one number, not containing the part of the email before `@` (any letter case)"; letter is `\p{L}`, digit is `\d`. Must not throw when `email` is not a string or has no `@`. Table test in `src/modules/auth/password-rules.spec.ts`: each rule alone, several together, letter case, accented letter, one-letter email name, bad email.
- [X] T005 [P] Create `src/modules/email/email.module.ts`, `email.service.ts` and `email.service.spec.ts` (research R1). With `EMAIL_API_KEY`: `POST https://api.resend.com/emails`; without it outside production: Mailpit `http://localhost:8025/api/v1/send`. One `send` that goes through `runInBackground` (T003), and two messages: verification code, and account exists (tells the owner to sign in). Email wording is (proposed). When `NODE_ENV === 'test'`, `send` does nothing (the unit tests pass another `NODE_ENV` through a fake config): a key in `.env` must never send real email from tests. On failure log the user id plus HTTP status or error class; never the address, the code or the provider's response body. Unit-test both request shapes and the failure path with `fetch` mocked; a failure must not reject.
- [X] T006 [P] Create `src/modules/auth/email-verification.service.ts` on `auth_throttles` (`scope = verify_email`, `subjectKey` = SHA-256 of the lower-cased email) and `email_verification_codes`. Follow the event table in `specs/5/data-model.md` exactly; time is a parameter. Needs T001.
  - `claim(email)`: for sign-up and sign-in; create when absent, restart (count 0, `lastSentAt` = now) when at least 60 s old, else refuse; returns whether claimed. Atomic: parallel calls have one winner (a P2002 on create counts as refused).
  - `start(email)`: create or restart unconditionally; only for a user just created.
  - `claimResend(email)`: conditional `updateMany` on an existing row with `lastSentAt` at least 60 s old; return `claimed`, `too_soon` or `absent`. Never creates a row.
  - `issueCode(userId)`: `randomInt` 6 digits zero-padded, void the live code, store SHA-256 of `<userId>:<code>` with `expiresAt` = now + 10 minutes, return the code. A P2002 on the live-code index means another request won: return null.
  - `attempt(email)`: one conditional `updateMany` (`failedCount < 5`, `lastSentAt` within 10 minutes) that increments; when it matches nothing, read the row to answer `expired` (checked first, also when absent) or `locked`.
  - `consume(userId, code)`: compare with `timingSafeEqual`, then conditionally set `consumedAt` on the live, unexpired code; true only for the winner.
  - `clear(email)`: delete the row.
- [X] T007 Unit-test `src/modules/auth/email-verification.service.spec.ts` with an in-memory fake, as in `sign-in-throttle.service.spec.ts`: every cell of the event table; a refused claim does not refill attempts; parallel claims have one winner; 20 parallel attempts let 5 through; parallel resends have one winner; expired wins over locked. Needs T006.
- [X] T008 Register `EmailModule` and `EmailVerificationService` in `src/modules/auth/auth.module.ts`. Create `test/sign-up.e2e-spec.ts` with the app built as in `test/auth.e2e-spec.ts`, users at `@signup.e2e.test`, cleanup of its own users and only its own throttle keys, and `EmailService` overridden by a fake recording messages (so codes can be read). Run `pnpm typecheck`. Needs T005, T006.

**Checkpoint**: units pass; no endpoint yet.

---

## Phase 3: User Story 1 - Sign up with email and password (P1)

**Goal**: `POST /api/v1/auth/sign-up` per [contracts/auth-sign-up.md](./contracts/auth-sign-up.md).

**Independent Test**: a sign-up creates one unverified user, sends one code and sets no session; repeating it answers identically and creates nothing.

### Tests (write first)

- [X] T009 [P] [US1] In `test/sign-up.e2e-spec.ts`: new email → 201 `{ next: "verify-email" }`, no `agi_sid`, unverified user, one code message, only a hash stored; email trimmed and lower-cased; verified or deactivated password account → same status and body, user unchanged, no code, one account-exists message; unverified password account → same status and body, password and full name replaced, open sessions ended, old code voided, one new code, no account-exists message; repeated within 60 s → the same 201 for new, unverified and verified emails alike, password unchanged, nothing sent; Google-only → 409 `GOOGLE_ONLY_EMAIL`, unchanged; invalid email, spaces-only name, unknown field → 400 `VALIDATION_FAILED`; missing CSRF → 403 `CSRF_INVALID`; two parallel sign-ups → both 201, one user, one code; a leftover locked throttle row with no user → sign-up creates the user and its code works. Needs T008.

### Implementation

- [X] T010 [P] [US1] Create `src/modules/auth/dto/sign-up.dto.ts`: `email` trimmed and lower-cased, "valid format, at most 254"; `fullName` trimmed, "at least one non-space character, no maximum" (decision #36, so no `@MaxLength`, with a why-comment); `password` string, `@MaxLength(128)` and the T004 decorator. Needs T004.
- [X] T011 [US1] Add `signUp(dto)` to `src/modules/auth/auth.service.ts`: hash the password first in every case; look up the user; Google-only (`passwordHash` null) → 409 `GOOGLE_ONLY_EMAIL` with the contract text; no account → create the user, `start`, `issueCode`, email it (P2002 on create → send nothing); existing account → `claim`, refused → do nothing more; verified or deactivated account → account-exists email; unverified active account → void the live code, end open sessions (`password_reset`), one conditional `updateMany` (unverified, active, has a password) with the new hash and full name, then `issueCode` and email only if it matched. Always return `{ next: 'verify-email' }`. Needs T006, T010.
- [X] T012 [US1] Add `@Public()` `@Post('sign-up')` (201, why-comment, `@ApiResponse` for 201, 400, 403, 409) to `src/modules/auth/auth.controller.ts`; T009 passes. Needs T009, T011.

**Checkpoint**: sign-up works; codes can be read in Mailpit.

---

## Phase 4: User Story 2 - Email verification (P1) 🎯 MVP ends here

**Goal**: `POST /auth/verify-email`, `POST /auth/resend-code`, and the changed `POST /auth/sign-in`.

**Independent Test**: create an unverified user with a code directly in the database; verifying gives a session accepted by `GET /auth/me`.

### Tests (write first)

- [X] T013 [P] [US2] In `test/sign-up.e2e-spec.ts`, moving time by editing `lastSentAt`/`expiresAt` rows: right code → 200 `next: "home"`, session cookie, `emailVerifiedAt` set, `/auth/me` works; same code again → 400 `CODE_EXPIRED`; 5 wrong → 400 `INCORRECT_CODE` each, 6th with the right code → 429 `CODE_LOCKED`; sign-up again while locked and within 60 s → 201 and still locked; sign-up again after 60 s with a new password, then the new code → verified, the new password signs in and the old one does not; the old code after that → refused; after resend the new code works and the old fails; over 10 minutes → `CODE_EXPIRED`; 20 parallel wrong codes → at most 5 `INCORRECT_CODE`; same right code in parallel → one session; resend within 60 s → 429 `RESEND_TOO_SOON`; resend with no row → 200, no message, no row; a verified password email and an unknown email behave the same as each other and send no code; deactivated with the right code → 403 `ACCOUNT_DEACTIVATED`, no session; code not 6 digits → 400; both routes without CSRF → 403. Needs T008.
- [X] T014 [P] [US2] In `test/auth.e2e-spec.ts`: override the email sender; change the unverified sign-in case to 200 `next: "verify-email"`, no cookie, no session row, one code; a second sign-in within 60 s sends none; a wrong password sends none. Rewrite the `/auth/me` unverified case and the Google-link-unverified case to create their session row directly instead of by sign-in. Include the new throttle scope in cleanup. Needs T008.

### Implementation

- [X] T015 [P] [US2] Create `src/modules/auth/dto/verify-email.dto.ts` (`email` as in sign-up; `code` matching `^\d{6}$`) and `src/modules/auth/dto/resend-code.dto.ts` (`email`).
- [X] T016 [US2] Add `verifyEmail(dto, req, res)` and `resendCode(dto)` to `src/modules/auth/auth.service.ts`. Verify: `attempt` first (429 `CODE_LOCKED`, 400 `CODE_EXPIRED`); load the user, requiring `emailVerifiedAt` null and a `passwordHash`; no match or `consume` false → 400 `INCORRECT_CODE`; deactivated → 403 `ACCOUNT_DEACTIVATED`; else set `emailVerifiedAt`, `clear`, `createSession`. Resend: `too_soon` → 429 `RESEND_TOO_SOON`; `claimed` and unverified, active password account → issue and email; always `{ sent: true }`. Use the contract's texts. Needs T006, T011, T015.
- [X] T017 [US2] Change `signIn` in `src/modules/auth/auth.service.ts`: after the deactivated check, an unverified user gets no session; `claim`, then issue and email when claimed; return `user` and `next: 'verify-email'`. Needs T016.
- [X] T018 [US2] Add `@Public()` `@Post('verify-email')` and `@Post('resend-code')` (`@HttpCode(200)`, why-comments, `@ApiResponse`s) and update the sign-in Swagger text in `src/modules/auth/auth.controller.ts`; point the unverified row of `specs/4/contracts/auth-sign-in.md` to `specs/5/contracts/auth-sign-up.md`. T013 and T014 pass. Needs T013, T014, T017.

**Checkpoint**: MVP. A new user can sign up, verify and reach the app.

---

## Phase 5: User Story 3 - Google sign-up (P2)

**Goal**: confirm #4 already meets this; no production code expected.

**Independent Test**: the Google cases of `test/auth.e2e-spec.ts` pass.

- [X] T019 [US3] In `test/auth.e2e-spec.ts` confirm the existing cases cover: redirect to Google; new account created verified with a session, going to `/home`. Extend the creation case to assert `emailVerifiedAt` is set and no verification code row exists, if it does not already. If a case fails, STOP and report.

---

## Phase 6: User Story 4 - Password security (P2)

**Goal**: weak passwords are refused by the API with the failed rules named.

**Independent Test**: each weak password answers 400 and creates no user.

- [X] T020 [US4] In `test/sign-up.e2e-spec.ts`, an `it.each` over: under 8 characters, no letter, no number, contains the email name in another letter case, over 128 → 400 `VALIDATION_FAILED`, the matching entry in `error.details`, no user created. A password failing two rules lists both. Needs T012.

---

## Phase 7: Polish and cross-cutting

- [ ] T021 Ask the user for the sender address, then add `EMAIL_FROM` to `env.staging.vars` and `env.production.vars` in `wrangler.jsonc`. The user sets the secret: `wrangler secret put EMAIL_API_KEY --env <env>`. Both must exist before the PR merges; note it under Risk in the PR.
- [X] T022 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm db:check` and fix what fails.
- [X] T023 Run the scenarios of `specs/5/quickstart.md` against `pnpm start:dev` with Mailpit, including background sending (research R2). Record anything not run. Needs T022. (2026-11-25: scenarios 1, 2, 8 first half, 11 and the notice of 10 run by hand with `wrangler dev` and Mailpit; `waitUntil` delivered the emails. The rest is covered by `test/sign-up.e2e-spec.ts` only.)
- [X] T024 Review the diff with the `code-reviewer` and `security-auditor` definitions in `.claude/agents/`, when the user asks for it; record findings in `specs/5/plan.md`. Needs T022.
- [ ] T025 After the staging deploy: check that the code email arrives (background sending, research R2) and that sign-up, verify and sign-in do not hit error 1102 (CPU); record the result in `specs/5/research.md`. Needs T021 and the merge.
- [X] T026 Fix the review findings R1, R3, R5, R7, R8, R9 of `specs/5/plan.md`. They change T006, T011, T013 and T016: one `claim` for every email, no `start`/`claimResend`/`clear`, password set by `verify-email`. The unverified sign-in cases of T014 live in `test/sign-up.e2e-spec.ts`.
- [X] T027 Add race tests for the paths coverage showed missing: Google link against verification, another Google account on the same email, verification against a changed account, sign-up against Google or a verification (`test/auth.e2e-spec.ts`, `test/sign-up.e2e-spec.ts`).

---

## Dependencies

- Setup (T001 to T003) → Foundational (T004 to T008) → stories.
- US1 → US2 (same service file; sign-up starts the window). US2 can be tested without the sign-up route.
- US3 is independent. US4 needs US1.
- T005 needs T002 and T003; T006 needs T001; T007 needs T006; T008 needs T005 and T006.
- Polish comes last; T021 blocks the merge, not development.

## Parallel examples

- Setup: T001, T002, T003.
- Foundational: T004 with T005 and T006, once their setup tasks are done.
- US1: T009 (tests) with T010 (DTO).
- US2: T013, T014 and T015 (three different files).
- US3: T019 after T014 (same file).
- US4: none; T020 shares its file with T009 and T013.

## Implementation strategy

1. **MVP**: Phases 1 to 4. Sign-up alone (US1) leaves users unable to enter, so US1 and US2 ship together.
2. Then US3 and US4, which are mostly tests.
3. Polish, then the PR into `develop` after T021.
