# Implementation Plan: #51 Refactor auth module structure (backend)

**Branch**: `refactor/51-refactor-auth-module-structure` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/51/spec.md`

## Summary

Split `AuthService` (323 lines) into `SessionService`, `SignInService`, `SignUpService` and `GoogleSignInService`, group the files of `src/modules/auth` by concern, and move the Google routes to `GoogleAuthController` with the callback decisions in `GoogleSignInService`. Code is moved, not rewritten: each database call keeps its order, conditions and security comment. No behavior change.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 tooling, NestJS 11, Prisma 7.10 (D1 adapter)

**Primary Dependencies**: existing only

**Storage**: Cloudflare D1; no schema or migration change

**Testing**: Jest unit and e2e (local D1). Baseline on `9458ecf`: lint and typecheck clean, 69 unit and 105 e2e tests pass

**Target Platform**: Cloudflare Workers

**Project Type**: web-service (REST API)

**Performance Goals**: unchanged; same queries and same number of password derivations per request

**Constraints**: routes, DTOs, status codes, error codes/messages, cookies and redirects unchanged; existing e2e tests change only import paths; no `forwardRef`, no circular imports

**Scale/Scope**: 7 routes, 1 service split into 4, 1 controller into 2, 4 new unit specs

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| Thin controllers: no Prisma calls, no business rules | Pass: Google callback logic moves to the service (R2) |
| No circular imports, no `forwardRef` | Pass: dependency graph below is acyclic |
| Export a service only when another module needs it | Pass: `AuthModule` exports nothing (R6) |
| Services call Prisma directly, no repository layer | Pass |
| `@Public()` with a why-comment | Pass: comments move with the routes |
| No new dependency, no schema change | Pass |
| One folder per feature with `<feature>.service.ts` | **Deviation required by the card**: subfolders per concern. `nestjs.md` gets one line so rule and code agree |

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/51/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md              # /speckit-tasks, not created here
```

No `contracts/`: the API does not change. The contracts that must keep holding are `specs/4/contracts/auth-sign-in.md` and `specs/5/contracts/auth-sign-up.md`.

### Source Code (repository root)

```text
src/
├── database/prisma-errors.ts                # isUniqueConflict (moved)
└── modules/auth/
    ├── auth.module.ts                       # providers, 2 controllers, no exports
    ├── auth.controller.ts                   # sign-in, sign-up, verify-email, resend-code, me
    ├── auth-errors.ts                       # accountDeactivated()
    ├── auth-user.select.ts                  # shared user selects
    ├── throttle-key.ts                      # throttleKey(scope, email)
    ├── dto/                                 # only the password-rules import path changes
    ├── session/
    │   └── session.service.ts, .spec.ts (new)
    ├── sign-in/
    │   ├── sign-in.service.ts, .spec.ts (new)
    │   └── sign-in-throttle.service.ts, .spec.ts
    ├── sign-up/
    │   ├── sign-up.service.ts, .spec.ts (new)
    │   └── email-verification.service.ts, .spec.ts
    ├── google/
    │   ├── google-auth.controller.ts (new)
    │   ├── google-sign-in.service.ts, .spec.ts (new)
    │   └── google-oauth.service.ts, .spec.ts
    └── password/
        └── password.service.ts, password-rules.ts and their specs
test/auth.e2e-spec.ts, sign-up.e2e-spec.ts   # import paths only
.claude/rules/nestjs.md                      # one line on subfolders
```

`auth.service.ts` is deleted.

**Structure Decision**: one `AuthModule`; helpers used by several concerns stay at the module root. Files move with `git mv` so history follows.

## Design

Dependencies (besides Prisma and Config), all one way:

| Class | Depends on |
|-------|------------|
| `SessionService` | none |
| `SignInService` | Password, SignInThrottle, EmailVerification, Session |
| `SignUpService` | Password, EmailVerification, Session |
| `GoogleSignInService` | GoogleOAuth, Session |
| `EmailVerificationService` | Email |
| `AuthController` | SignIn, SignUp, Session |
| `GoogleAuthController` | GoogleOAuth, GoogleSignIn |

| Method | From | Notes |
|--------|------|-------|
| `SessionService.createSession`, `me`, `toResult` | `AuthService` | `toResult` becomes public (unverified sign-in uses it); owns `SignedInUser` and `SignInResult` |
| `SignInService.signIn` | `AuthService` | |
| `SignUpService.signUp`, `verifyEmail`, `resendCode` | `AuthService` | keeps `awaitsVerification`, `emailAlreadyExists`, `createUnverifiedUser`, `signUpAgain` private to the file |
| `EmailVerificationService.sendCode` | `AuthService.sendCode` | shared by sign-in and sign-up (R3) |
| `GoogleSignInService.signIn(profile, req, res)` | `signInWithGoogle` | |
| `GoogleSignInService.handleCallback(...)` | `AuthController.googleCallback` | returns the frontend path; never throws for an expected failure |

`GoogleAuthController` keeps only HTTP work: read, set and clear the OAuth cookie, and redirect to `APP_ORIGIN` + path.

## Must not change (checked in review)

1. Sign-in: `throttle.attempt` before the user lookup and password check; `verifyDummy` for unknown or Google-only accounts; throttle reset before the deactivated check.
2. Sign-up: `verification.claim` after hashing and before `create`; conditional `updateMany` guards and their `count === 0` branches.
3. Verify: `attempt` before lookup, `consume` before the deactivated check, sessions ended after the password is stored and before the new session.
4. Google: OAuth cookie cleared first; `access_denied` before `authenticate`; lookup by subject then email; sessions ended before linking; the conditional link update; only `ForbiddenException` maps to `account_deactivated`.
5. Logs: the authenticate failure logs our own message, the sign-in failure only the error class.

## Risks

- **Moved security code**: the main risk. Covered by the unchanged e2e tests plus the list above; run `security-auditor` before the PR.
- **Swagger `operationId`**: the two Google routes change from `AuthController_*` to `GoogleAuthController_*` in `/api/docs-json`. No use found in the frontend's `package.json` or `src`.
- **Logger context**: Google warnings show `GoogleSignInService` instead of `AuthController`.
- **Open PRs on auth** (reset password, sign-out) will conflict; merge this first.
