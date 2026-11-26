# Implementation Plan: #22 Implement feature Profile and Account Settings (backend)

**Branch**: `feat/22-profile-and-account-settings` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/22/spec.md`

## Summary

Backend for the Profile / Account settings page: read and edit the profile (name, avatar, password and Google status), upload/serve/remove an avatar in R2, change the password (other sessions signed out, wrong current password rate-limited), and list/sign out active sessions. Nine routes, no schema change. Avatar upload is a `multipart/form-data` `PUT` (field `file`), read from the request stream by the avatar service with a size cap and parsed by the native `Response.formData()`, type checked by magic bytes (D2); change password is one atomic `DB.batch` (D6); the throttle reuses the sign-in lockout logic with the existing `change_password` scope (D7).

This repo does only the card's **Backend** scope; the settings page itself belongs to the frontend repo.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 tooling, NestJS 11, Prisma 7.10 (D1 adapter)

**Primary Dependencies**: existing only: Web `Response.formData()` (platform), R2 binding `IMAGES` via `getBindings()`, `PasswordService`, `failedPasswordRules`, `SignInThrottleService`

**Storage**: D1 `users`, `user_sessions`, `auth_throttles` (no migration); R2 `IMAGES` objects `avatars/<userId>/<uuid>`

**Testing**: Jest unit (`*.spec.ts` next to services), e2e against local D1/R2 (`test/*.e2e-spec.ts`, `getPlatformProxy`)

**Target Platform**: Cloudflare Workers (no Node-only runtime APIs; ~10 ms CPU on the free plan)

**Project Type**: web-service (REST API)

**Performance Goals**: profile/sessions reads: one D1 query; change password: one PBKDF2 verify + one hash (2 × ~4.5 ms CPU, twice reset's cost; staging check for error 1102, research D6) + one batch

**Constraints**: avatar ≤ 5 MB, JPEG/PNG/WebP/GIF by magic bytes; CSRF on every write; `ip_address` never returned; atomic multi-row writes only via `DB.batch`

**Scale/Scope**: 9 routes, 1 new module (`users`), 2 new services, 1 throttle refactor, 1 filter fix, ~25 e2e cases

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| Card is the scope | Pass: card + clarifications Q1–Q5 only. Other users' avatars left out (D4) |
| Session on every route, CSRF on writes | Pass: no `@Public()` added |
| User from `@CurrentUser()` only; no ids from the body | Pass: session id from `SessionUser.sessionId`; `:sessionId` checked against the user (404 otherwise) |
| 404 for content the user may not see | Pass: another user's session → 404 `SESSION_NOT_FOUND` |
| Explicit `select`, never return hashes | Pass: `hasPassword`/`googleLinked` booleans only |
| `ip_address`/`user_agent` only to their owner | Pass: `userAgent` in the owner's list only, no IP |
| Don't trust client MIME; server-side size limit | Pass: magic bytes; body read capped at 5 MB + 64 KB, file ≤ 5 MB (D2, D3) |
| Remote D1/R2 only from CI | Pass: local dev and e2e use the local bucket in `.wrangler/` |
| Atomic writes via `DB.batch` | Pass: change password (D6) |
| Lockout via `auth_throttles`, 429 with stable code | Pass: `CHANGE_PASSWORD_LOCKED` (D7) |
| Log ids, not personal data | Pass: failed R2 deletes log user id + key only |
| List endpoints paginate (`limit`/`cursor`) | **Deviation**: `GET /auth/sessions` returns all live sessions (a handful per user); justified in D8 and a code comment |
| DTO strings bounded by DB CHECKs | Pass: `fullName` trimmed + not empty (only CHECK); no max in DB or sign-up |
| No new dependency, no schema change | Pass |
| New endpoints need e2e (happy, 401, 403 CSRF, 400, 404) | Planned in quickstart |

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/22/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── users-me.md
│   └── auth-account.md
└── tasks.md              # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/
├── app.module.ts                           # + UsersModule
├── common/filters/all-exceptions.filter.ts # + body-parser errors (expose + 4xx) → their status (D3)
└── modules/
    ├── users/                              # new
    │   ├── users.module.ts
    │   ├── users.controller.ts             # GET/PATCH /users/me, PUT/DELETE/GET /users/me/avatar
    │   ├── profile.service.ts              # profile read/edit
    │   ├── avatar.service.ts               # capped body read, formData, R2 put/get/delete, key swap (D2, D4, D5)
    │   ├── image-type.ts                   # pure magic-byte detection + AVATAR_MAX_BYTES
    │   ├── read-body.ts                    # capped stream read (413 past AVATAR_BODY_LIMIT) + spec
    │   ├── dto/update-profile.dto.ts
    │   └── *.spec.ts
    └── auth/
        ├── auth.controller.ts              # + POST change-password, GET/DELETE sessions, DELETE sessions/:id
        ├── auth.module.ts                  # + AccountSecurityService
        ├── dto/change-password.dto.ts
        ├── account/                        # new
        │   ├── account-security.service.ts # change password (D6), sessions list/sign-out (D8)
        │   └── account-security.service.spec.ts
        └── sign-in/sign-in-throttle.service.ts  # + scope argument, default 'sign_in' (D7); spec updated
test/
├── profile.e2e-spec.ts                     # new
└── account-security.e2e-spec.ts            # new
.claude/rules/
├── nestjs.md                               # + one line: sessions list not paginated (D8)
└── security.md                             # + one line: avatars served to their owner only (D4)
```

**Structure Decision**: one new `users` module for user data; password and sessions extend the existing `auth` module in a new `account/` subfolder, so no service is exported across modules (D1).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `GET /auth/sessions` not paginated | A user has a few live sessions; the list must show the current one marked | Cursor pagination adds DTO, cursor logic and tests for lists of ~1–5 rows |
