# Feature Specification: #51 Refactor auth module structure (backend)

**Card:** https://trello.com/c/kxNimqtP/51-refactor-auth-module-structure-backend
**List (status):** In Progress
**Labels:** Backend, Phase 3, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-25 14:20 (GMT+7)

---

## Description

## Overview
Restructure `src/modules/auth` in agi-board-backend into smaller, single-purpose services. No behavior change.

## Why
- `AuthService` (323 lines) handles sign-in, sign-up, email verification, Google account linking and session creation.
- All files sit flat in one folder; upcoming reset-password and sign-out work would make it larger.
- Duplicated code: the `ACCOUNT_DEACTIVATED` error (3 times), the user `select`, and the throttle key hashing.
- `AuthController` holds Google callback logic, although controllers should be thin.

## Scope
- Split `AuthService` by flow:
  - `SessionService`: `createSession`, `me`, `toResult`
  - `SignInService`: password sign-in
  - `SignUpService`: sign-up, verify email, resend code
  - `GoogleSignInService`: find, link or create the account
- Group files by concern: `session/`, `sign-in/`, `sign-up/`, `google/`, `password/`. Keep one `AuthModule` and `dto/`.
- Split the controller: move the Google routes to `GoogleAuthController`. Routes stay the same.
- Extract the shared auth errors, user `select` and throttle key helper.
- Move `isUniqueConflict` out of the email verification service to a shared place.
- Remove `AuthModule` exports that no other module uses.
- Update imports in unit and e2e tests; add unit specs for the new services.

## Out of Scope
- New features (reset password, sign-out), frontend changes
- Changes to the API contract, DB schema or migrations
- A repository layer or new dependencies

## Rules
- Keep routes, DTOs, status codes, error codes/messages, cookies and redirects unchanged.
- Keep security behavior: attempts are counted before the password/code is checked, dummy password verification for unknown emails, conditional updates against races, pre-hijack guard on Google linking.
- Keep the security comments with the code they explain.
- Follow `.claude/rules/nestjs.md`: no `forwardRef`, no circular imports.

## Acceptance Criteria
- [ ] `AuthService` is replaced by services that each cover one flow
- [ ] Controllers contain no Prisma calls or business rules
- [ ] The duplicated errors, `select` and key hashing each exist in one place
- [ ] Existing auth, session and sign-up e2e tests pass with only import paths changed
- [ ] Each new service has a unit spec
- [ ] Lint, type-check, build, unit and e2e tests pass
- [ ] `pnpm db:check` reports no difference

---

## Acceptance Criteria

- [ ] `AuthService` is replaced by services that each cover one flow
- [ ] Controllers contain no Prisma calls or business rules
- [ ] The duplicated errors, `select` and key hashing each exist in one place
- [ ] Existing auth, session and sign-up e2e tests pass with only import paths changed
- [ ] Each new service has a unit spec
- [ ] Lint, type-check, build, unit and e2e tests pass
- [ ] `pnpm db:check` reports no difference

---

## Checklists

None

## Comments

None

## Attachments / Links

None
