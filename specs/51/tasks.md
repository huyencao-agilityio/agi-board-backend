# Tasks: #51 Refactor auth module structure (backend)

**Input**: Design documents from `specs/51/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: the card asks for a unit spec per new service. Existing e2e tests may change only import paths.

**Organization**: the card has no user stories. Each phase is one flow taken out of `AuthService`:

- **US1 Sign in** (P1)
- **US2 Sign up and verification** (P2)
- **US3 Google sign-in** (P3)

Code is moved, not rewritten. Keep statement order, query conditions and security comments (plan.md, "Must not change"). Each phase ends with lint, typecheck, unit and e2e tests green.

## Phase 1: Setup

- [X] T001 Record the baseline on `9458ecf` in `specs/51/plan.md`: lint, typecheck, build and `db:check` clean, 69 unit and 105 e2e tests pass

## Phase 2: Foundational

**Purpose**: file layout and shared pieces every flow needs. `AuthService` stays until US3.

- [X] T002 Move with `git mv` (specs included), fixing relative imports: `password.service.ts` and `password-rules.ts` to `src/modules/auth/password/`, `sign-in-throttle.service.ts` to `sign-in/`, `email-verification.service.ts` to `sign-up/`, `google-oauth.service.ts` to `google/`. Update imports in `src/modules/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `dto/sign-up.dto.ts`, `dto/verify-email.dto.ts`, and only the import lines of `test/auth.e2e-spec.ts` and `test/sign-up.e2e-spec.ts`
- [X] T003 Create `src/database/prisma-errors.ts` with `isUniqueConflict` moved from `src/modules/auth/sign-up/email-verification.service.ts`; import it there and in `src/modules/auth/auth.service.ts`
- [X] T004 Create `src/modules/auth/throttle-key.ts`: `throttleKey(scope, email)` returns `{ scope, subjectKey }`, SHA-256 hex of the lower-cased email. Use it in `sign-in/sign-in-throttle.service.ts` and `sign-up/email-verification.service.ts`; the code hash stays local
- [X] T005 Create `src/modules/auth/auth-errors.ts` with `accountDeactivated()` (code and message unchanged) and replace the 3 copies in `src/modules/auth/auth.service.ts`
- [X] T006 Create `src/modules/auth/auth-user.select.ts` with `signedInUserSelect` and `passwordUserSelect` (research R4) and use them in `src/modules/auth/auth.service.ts`, including `me` and the Google select (base plus `deactivatedAt`, `googleSubject`)
- [X] T007 Create `src/modules/auth/session/session.service.ts` with `createSession`, `me`, public `toResult`, and the types `SignedInUser` and `SignInResult`. Register it in `auth.module.ts`, inject it in `auth.service.ts` in place of the moved methods, and point `GET /auth/me` in `auth.controller.ts` at it (after T006)
- [X] T008 Create `src/modules/auth/session/session.service.spec.ts`: only the token hash is stored, the cookie carries the raw token, user agent cut at 512, `cf-connecting-ip` before `req.ip`, `next` for verified and unverified, result holds only id, email, fullName, systemRole (after T007)
- [X] T009 Move `sendCode` from `auth.service.ts` to `src/modules/auth/sign-up/email-verification.service.ts` (inject `EmailService`), call it from `auth.service.ts`, and pass a fake `EmailService` in `email-verification.service.spec.ts`; add cases: sends the issued code; sends nothing when `issueCode` returns null (after T003, T004)
- [X] T010 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`; confirm `git diff -M origin/develop -- test` shows only import lines

**Checkpoint**: shared pieces in place, behavior unchanged.

## Phase 3: US1 Sign in (P1) 🎯 MVP

**Goal**: password sign-in lives in `SignInService`.

**Independent test**: `test/auth.e2e-spec.ts` and the unverified sign-in cases of `test/sign-up.e2e-spec.ts` pass unchanged.

- [X] T011 [US1] Create `src/modules/auth/sign-in/sign-in.service.ts` by moving `signIn` from `src/modules/auth/auth.service.ts`; register it in `auth.module.ts`, call it from `auth.controller.ts`, remove the method from `auth.service.ts`
- [X] T012 [US1] Create `src/modules/auth/sign-in/sign-in.service.spec.ts`: locked attempt answers 429 `SIGN_IN_LOCKED` with no lookup and no password check; unknown email and Google-only account use `verifyDummy` and record the failure; wrong password 401; correct password resets the throttle, also for a deactivated account (403); unverified: no session, code sent only when `claim` succeeds; verified: session created

**Checkpoint**: run the T010 checks.

## Phase 4: US2 Sign up and verification (P2)

**Goal**: sign-up, verify email and resend live in `SignUpService`.

**Independent test**: `test/sign-up.e2e-spec.ts` passes unchanged, including its race tests.

- [X] T013 [US2] Create `src/modules/auth/sign-up/sign-up.service.ts` by moving `signUp`, `verifyEmail`, `resendCode`, `createUnverifiedUser`, `signUpAgain`, `awaitsVerification` and `emailAlreadyExists` from `src/modules/auth/auth.service.ts`; put the select used by `resendCode` and `signUpAgain` in one constant there; register it in `auth.module.ts`, call it from `auth.controller.ts`
- [X] T014 [US2] Create `src/modules/auth/sign-up/sign-up.service.spec.ts`. Sign-up: refused 409 for verified, Google-only and deactivated accounts; `claim` runs before `create`; no code without a claim; unique conflict falls to sign-up-again; `count === 0` gives 409. Verify: `attempt` before lookup; `CODE_LOCKED`, `CODE_EXPIRED`, `INCORRECT_CODE`; deactivated only after `consume`; `count === 0` gives `INCORRECT_CODE` and ends no session; sessions ended before the new one. Resend: `RESEND_TOO_SOON`; same answer for an unknown email

**Checkpoint**: run the T010 checks.

## Phase 5: US3 Google sign-in (P3)

**Goal**: Google has its own service and controller; `AuthService` is gone.

**Independent test**: the Google tests of `test/auth.e2e-spec.ts` pass unchanged.

- [X] T015 [US3] Create `src/modules/auth/google/google-sign-in.service.ts` with `signIn(profile, req, res)` (moved `signInWithGoogle`) and `handleCallback` (moved from the controller's callback: `access_denied`, authenticate, sign in, error mapping and its log lines), which returns the frontend path
- [X] T016 [US3] Create `src/modules/auth/google/google-auth.controller.ts` (`@ApiTags('auth')`, `@Controller('auth/google')`, routes `GET /` and `GET callback`) with the `@Public()` comments, cookie handling (cleared before `handleCallback`) and redirect; remove these from `src/modules/auth/auth.controller.ts`. The cookie path stays `/api/v1/auth/google`
- [X] T017 [US3] Delete `src/modules/auth/auth.service.ts`; in `src/modules/auth/auth.module.ts` register both controllers and all services and remove `exports`
- [X] T018 [US3] Create `src/modules/auth/google/google-sign-in.service.spec.ts`: lookup by subject then email; new account created verified; linking an unverified account ends sessions first and drops the password; linking a verified one keeps both; link update is conditional; subject mismatch 401; deactivated 403; callback paths `/sign-in`, `?error=google_failed` (authenticate and sign-in failures), `?error=account_deactivated`, `/home`, `/verify-email`; a sign-in failure logs only the error class

**Checkpoint**: run the T010 checks.

## Phase 6: Polish

- [X] T019 [P] Add one line on subfolders per concern in a large module to `.claude/rules/nestjs.md` ("Module layout")
- [X] T020 Run all of `specs/51/quickstart.md`: lint, typecheck, build, unit, e2e, `db:check`, and the structure checks (including no new circular import between the auth files)
- [X] T021 Review the diff against "Must not change" in `specs/51/plan.md`, then run the `code-reviewer` and `security-auditor` agents and fix Critical and High findings

## Dependencies

- Phase 2 blocks every story. T002 comes first. T003 to T006 edit shared files (`auth.service.ts`, the throttle services), so run them in order.
- US1 and US2 are independent of each other. T015 and T016 are independent of US1 and US2, but T017 needs T011, T013, T015 and T016.
- `auth.module.ts`, `auth.controller.ts` and `auth.service.ts` are edited in every story, so do the stories one after another.
- Phase 6 needs all stories.

## Parallel examples

- After each service exists, its spec (T012, T014, T018) can be written while the next story starts.
- T019 can be done at any time.

## Implementation strategy

MVP is Phase 2 plus US1: it works on its own because `AuthService` still serves the other flows. The card is done only after Phase 6; one PR for the whole card, one commit per phase.
