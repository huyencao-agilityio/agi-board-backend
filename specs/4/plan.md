# Implementation Plan: #4 Implement feature User Sign In

**Branch**: `feat/4-implement-user-sign-in` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/4/spec.md`

## Summary

Backend half of WEB-01 "Sign in": email + password sign-in and Google sign-in, both ending in an httpOnly session cookie that expires after 7 idle days. A new `modules/auth/` adds `POST /auth/sign-in`, `GET /auth/google` and `GET /auth/google/callback`, a password verifier (PBKDF2-SHA256, see research R1), a sign-in throttle on the existing `auth_throttles` table (5 failures → 15 min lock), idle-session expiry, and a `SESSION_ENDED` code on 401 so the frontend can show the "You were signed out" notice. No SQL migration: `users`, `user_sessions` and `auth_throttles` already carry every column needed; the only schema edit is a new `expired` value in the `SessionEndReason` enum (enums are not enforced by D1, see research R5).

Frontend-only criteria (email format message, disabled button, spinner, show/hide password, links to WEB-14/WEB-02, "Password updated" notice) need no backend work beyond the contract in [contracts/auth-sign-in.md](./contracts/auth-sign-in.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 tooling, NestJS 11, Prisma 7.10.1 (D1 adapter)

**Primary Dependencies**: existing (`@nestjs/*`, `class-validator`, `cookie-parser`, `zod`); none new for hashing: PBKDF2-SHA256 through WebCrypto (research R1, an accepted exception to the argon2id rule because of the Workers free plan). Google OAuth uses plain `fetch`, no OAuth library (research R2).

**Storage**: Cloudflare D1 (SQLite). Tables used: `users`, `user_sessions`, `auth_throttles`. No schema change.

**Testing**: Jest unit (`src/**/*.spec.ts`) and e2e (`test/*.e2e-spec.ts`, local D1). Google is faked at the `fetch` boundary.

**Target Platform**: Cloudflare Workers (no Node-only APIs, no native addons).

**Project Type**: web-service (REST API).

**Performance Goals**: sign-in stays inside the free-plan Worker CPU limit (about 10 ms); PBKDF2 iterations are tunable and still to be verified on staging (research R1).

**Constraints**: same response for unknown email and wrong password (status, body, similar timing); CSRF stays on for the public sign-in POST; no emails/tokens in URLs or logs; no `passwordHash` in any response.

**Scale/Scope**: 3 endpoints, ~6 new files, 1 guard change, 1 enum value, 4 env vars, 1 log serializer.

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so it defines no gates. The binding rules are `AGENTS.md` and `.claude/rules/*`; checked against them:

| Rule | Status |
|------|--------|
| Auth is global; open routes `@Public()` with a why-comment | Pass: sign-in and Google routes are `@Public()`, commented |
| CSRF on public writes | Pass: `POST /auth/sign-in` needs `X-CSRF-Token`; Google routes are `GET` |
| Never reveal whether an email has an account | Pass by design, with one spec-mandated exception (see Decisions, Q3) |
| Cookie flags, store only token hash | Pass: reuse `newSessionToken` / `hashSessionToken` |
| Lockout via `auth_throttles`, 429 with stable code | Pass |
| argon2id, WebAssembly/pure-JS | **Exception**: PBKDF2-SHA256 at 10 000 iterations because of the Workers free plan; accepted by the project owner, see research R1 |
| No new dependency for a few lines | Pass: Google via `fetch`; one hashing dependency only |
| New env var in `envSchema`, `.env.example`, `env.spec.ts` | Planned |
| Layering: controller thin, service owns Prisma | Pass |

Re-checked after Phase 1 design: still pass.

## Project Structure

### Documentation (this feature)

```text
specs/4/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── auth-sign-in.md
└── tasks.md              # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/
├── config/env.ts                       # + GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_IDLE_DAYS (default 7)
├── common/guards/session.guard.ts      # idle expiry (7 days) + 401 code SESSION_ENDED when a session was ended by something other than logout
├── modules/auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts              # sign-in, google, google/callback
│   ├── auth.service.ts                 # credential check, session creation, Google account merge
│   ├── password.service.ts             # PBKDF2-SHA256 hash + verify (shared with the sign-up ticket)
│   ├── sign-in-throttle.service.ts     # 5 fails / 15 min on auth_throttles, reset(email) for the reset-password ticket
│   ├── google-oauth.service.ts         # auth URL, state/PKCE, code exchange, id_token checks
│   ├── dto/sign-in.dto.ts
│   └── *.spec.ts
└── app.module.ts                       # import AuthModule
prisma/schema/enums.prisma             # SessionEndReason + expired
test/auth.e2e-spec.ts
.env.example
```

**Structure Decision**: single NestJS project, one feature folder as `.claude/rules/nestjs.md` requires.

## Decisions on the earlier open questions (answered 2026-11-23)

- **Q1 Frontend paths (resolved).** Frontend origin is `APP_ORIGIN`; WEB-03 is `/home`, WEB-16 is `/verify-email`, WEB-01 is `/sign-in`. The backend redirects to `APP_ORIGIN` + path, so every environment works with its own `APP_ORIGIN`.
- **Q2 Session expiry (resolved, scope grew).** An expired session means automatic sign-out: the user sees the sign-in form and must sign in again. This needs real expiry in the backend, which the card does not describe. Chosen: idle expiry of 7 days (proposed value, `SESSION_IDLE_DAYS`), measured on `last_active_at`. See research R5.
- **Q3 Deactivated account via Google (resolved).** Redirect to `/sign-in?error=account_deactivated`, as in the contract. The card should state this rule (see "Follow-ups").
- **Q4 Lock lifted by reset link (resolved).** This ticket only provides `SignInThrottleService.reset(email)` with a test; the reset-password ticket (WEB-15) calls it.

## Follow-ups outside the code

- `spec.md` stays a verbatim copy of the card. The card has no rule for idle expiry, Google + deactivated, or the 7-day value; these are recorded here as `(proposed)`. Consider adding a Trello comment on card #4 listing them, so the reviewer and the frontend see the same rules. Not done automatically: writing to Trello is outward-facing.
- Decided after analysis: every session end except `logout` (including `signed_out_by_user`) yields `SESSION_ENDED` and the "You were signed out" notice. `GOOGLE_*` variables are optional outside production and required in production. OAuth `code`/`state` are redacted from request logs (T016). The reset-password ticket must call `SignInThrottleService.reset(email)` (spec US1 criterion 7). `auth_throttles` rows for unknown emails are never cleaned up (accepted, commented in code).
- The frontend must handle `?error=google_failed`, `?error=account_deactivated` and the `SESSION_ENDED` code on 401.

## Review findings (code-reviewer and security-auditor, 2026-11-23)

Fixed in the follow-up commit:

- **Lockout bypass with parallel requests**: attempts are now counted before the password is checked, with one atomic increment (`SignInThrottleService.attempt`), so at most 5 of any number of parallel guesses are verified. Covered by a unit test and an e2e test with 20 parallel requests.
- **Google link to an unverified password account (pre-hijack)**: linking now drops the password and ends the open sessions of an account whose email was never verified. A verified account keeps its password.
- A correct password clears the failure count even for a deactivated account; the Google callback no longer logs database error messages (only the error class); the log redaction is case-insensitive; `SESSION_IDLE_DAYS` is capped at 30.

Accepted, not changed:

- Lockout is per email only (no per-IP limit), so anyone can lock a known email for 15 minutes; a Cloudflare rate-limit rule on `/auth/sign-in` would cover this.
- `auth_throttles` rows are never cleaned up (see the `shortcut:` comment).
- A deactivated account confirms a correct password with 403 (per the card).
- No absolute session lifetime: a session used at least once per 7 days never expires.

To check on staging: whether Cloudflare Workers Logs (`observability.enabled`) records the callback URL with `code` and `state` outside pino.
