# Implementation Plan: #5 Implement feature User Sign Up

**Branch**: `feat/5-implement-feature-user-sign-up` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/5/spec.md`

## Summary

Backend half of WEB-02 "Sign up" and WEB-16 "Verify email". Adds three public endpoints to `modules/auth/`: `POST /auth/sign-up`, `POST /auth/verify-email` and `POST /auth/resend-code`, plus an email sender (Resend over `fetch`, Mailpit locally). No session exists until the code is accepted, and an email that already has an account is refused (D9). Signing up again for an unverified account replaces its password and sends a new code (D4). `POST /auth/sign-in` changes for unverified accounts: no session, and a fresh code is sent (BRD #38).

Google sign-up needs no new code: `GET /auth/google` and its callback (#4) already create a verified account and a session. Their existing e2e tests cover section 3 of the criteria.

Frontend-only criteria (inline errors, disabled button, spinner, countdown) rely on [contracts/auth-sign-up.md](./contracts/auth-sign-up.md). The backend validates the same rules again.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 tooling, NestJS 11, Prisma 7.10.1 (D1 adapter)

**Primary Dependencies**: existing only. Email is sent with `fetch`, no SDK (research R1).

**Storage**: Cloudflare D1. Tables `users`, `email_verification_codes`, `auth_throttles`, `user_sessions`. No SQL migration expected; new `verify_email` value in the `AuthThrottleScope` enum (not enforced by D1; confirm with `pnpm db:check`).

**Testing**: Jest unit and e2e (local D1). Email is faked at the provider boundary.

**Target Platform**: Cloudflare Workers.

**Project Type**: web-service (REST API).

**Performance Goals**: stay inside the Workers free-plan CPU limit (about 10 ms): one PBKDF2 derivation per sign-up, email sent in the background.

**Constraints**: verify and resend answer the same with and without an account; CSRF on every write; no emails or codes in URLs or logs.

**Scale/Scope**: 3 endpoints, 1 changed endpoint, 1 enum value, 2 env vars.

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| `@Public()` with a why-comment, CSRF on public writes | Pass |
| Never reveal whether an email has an account | **Exception**: sign-up tells that an email has an account (D9, project owner); sign-in failure, resend and verify still hide it |
| Codes: `randomInt`, SHA-256 hash, `timingSafeEqual`, expiry, single use | Pass |
| Throttle via `auth_throttles`, 429 with a stable code | Pass |
| Emails sent after the writes, never inside them | Pass |
| Bound every string | **Exception**: full name has no maximum (decision #36); the request body limit bounds it |
| Atomic multi-step writes through `DB.batch` | Pass: each step is one conditional statement and a failed step is recovered by resend (research R4) |
| No new dependency | Pass |
| Env vars in `envSchema`, `.env.example`, `env.spec.ts` | Planned |

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/5/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/auth-sign-up.md
└── tasks.md              # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/
├── config/env.ts, env.spec.ts             # EMAIL_API_KEY, EMAIL_FROM
├── cloudflare.ts                          # background-task hook (waitUntil)
├── modules/email/
│   ├── email.module.ts
│   ├── email.service.ts                   # Resend, or Mailpit without a key
│   └── email.service.spec.ts
└── modules/auth/
    ├── auth.module.ts                     # import EmailModule, new provider
    ├── auth.controller.ts                 # 3 routes, sign-in Swagger text
    ├── auth.service.ts                    # signUp, verifyEmail, resendCode; signIn for unverified accounts
    ├── email-verification.service.ts      # issue/check codes, throttle window
    ├── email-verification.service.spec.ts
    ├── password-rules.ts, password-rules.spec.ts   # shared with the reset-password ticket
    └── dto/email.dto.ts (shared), sign-up.dto.ts, verify-email.dto.ts, resend-code.dto.ts
edge/src/index.mjs                         # pass waitUntil from cloudflare:workers
prisma/schema/enums.prisma                 # AuthThrottleScope + verify_email
test/sign-up.e2e-spec.ts                   # new
test/auth.e2e-spec.ts                      # unverified sign-in: no cookie, code sent
wrangler.jsonc, .env.example, README.md    # EMAIL_FROM var, EMAIL_API_KEY secret, drop unused SMTP_*
```

**Structure Decision**: sign-up stays in `modules/auth/`. Email gets its own module because invites and password reset also send email.

## Decisions (project owner, 2026-11-25)

- **D1 Email provider**: Resend. Local development uses Mailpit's HTTP API.
- **D2 Google-only email**: superseded by D9.
- **D3 Unverified sign-in**: changed in this ticket. No session; a fresh code is sent, at most one per 60 seconds. This replaces that row of `specs/4/contracts/auth-sign-in.md`.
- **D4 Sign-up again on an unverified account**: the password is replaced with the new one, the old code is voided and a new one is sent. This supersedes "nothing changed" and "its password stays the old one" in BRD §1 and decisions #36 and #37; the project owner confirmed it with the BRD. The full name is replaced too (proposed).
- **D8 Password at verification** (2026-11-25, R1): `verify-email` takes the password, which becomes the account's. Replaces the accepted remaining case of D4: whoever holds the mailbox chooses the password. A full name typed by someone else inside the cooldown can remain; it is editable in Profile.
- **D5 Silent sign-up cooldown**: for an unverified account, a sign-up within 60 seconds of the last sign-up or code answers the normal 201 but changes and sends nothing. No error code and no screen state (the `Too soon` error was dropped for now by the project owner, 2026-11-25). The limit itself stays: otherwise a repeated sign-up would refill the 5 tries and spam the mailbox. With D8 a corrected password still counts.
- **D6 AC 1.4**: superseded by D9.
- **D9 Existing email** (2026-11-25, after trying the flow): sign-up answers 409 `EMAIL_ALREADY_EXISTS` for a verified, Google-only or deactivated account, one message for all. An unverified password account may sign up again (D4). Google sign-up on a password account still merges (#4). The account-exists email is removed. Accepted: sign-up reveals which emails have an account; `.claude/rules/security.md` carries the exception.
- **D7 Frontend**: same card, built in the frontend repository.

## Risks and follow-ups

- **Deploy prerequisite**: `EMAIL_API_KEY` (secret) and `EMAIL_FROM` (verified domain) are required when `NODE_ENV=production`, so staging and production refuse to start without them. Set both before merging to `develop`.
- **Enumeration (accepted)**: sign-up reveals existing accounts (D9), so the sign-in difference of R2 adds nothing new. A rate limit on `sign-up` limits harvesting.
- **Code guessing**: 5 tries per code and one code per 60 seconds allow about 7 200 guesses a day, about 0.7% chance per day per account. No daily cap is specified.
- **Verification can be blocked (R4)**: looping resend and 5 wrong codes keeps locking the owner's codes and sends up to 1 440 emails a day. Needs a Cloudflare rate limit on `sign-up`, `resend-code` and `verify-email`; the client sets it up (project owner, 2026-11-25).
- **Frontend**: `SignInResult` with `next: "verify-email"` no longer comes with a cookie, so `/auth/me` answers 401 on `/verify-email`; the page must carry the email in client state.
- Sessions created for unverified accounts before this change stay valid until they end or go idle.
- BRD §1, the screen specs and decision #364 describe D4 and D5. D3 to D5 are not on the card.
- **Resend when locked**: WEB-16 keeps the 60-second countdown running (decision #365), matching `RESEND_TOO_SOON`; the WEB-16 mockup is updated.

## Review findings (code-reviewer and security-auditor, 2026-11-25)

Traced in the code. Outcome, 2026-11-25: R1 fixed (D8). R2 accepted. R3, R5, R7, R8, R9 fixed. R4 is a deployment rule, open. R6 needs no code: with D8 a failed retry only delays the code by 60 seconds.

| ID | Severity | Finding | Proposed fix |
|----|----------|---------|--------------|
| R1 | High, decide | Takeover: a stranger signs up first and keeps the 60-second window open with `resend-code`. The owner's sign-up is silently ignored, the owner enters a valid code, and the stranger's password is live. Wider than the case accepted in D4. | `verify-email` takes the password and stores it together with the verification: whoever holds the mailbox chooses the password |
| R2 | High, decide | Enumeration: sign-up then sign-in with the same password answers 200 for a new or unverified email and 401 for a verified one (consequence of D3). | Unverified sign-in answers the same 401 and emails a code with a link, or accept the leak |
| R3 | High | Enumeration: `resend-code` twice answers 200/429 for a pending account and 200/200 for an unknown one; `verify-email` differs the same way. | Resend also creates the row; a new user's first code uses `claim` |
| R4 | Medium | A stranger can loop resend plus 5 wrong codes and block verification; up to 1 440 emails a day to one address. | Cloudflare rate limit on `resend-code` and `verify-email` too |
| R5 | Minor | Parallel sign-ups can send two codes, and the second sign-up can slip in between `create` and `start`. | Open the window before creating the user (with R3) |
| R6 | Minor | A database error after a successful claim makes the retry within 60 seconds do nothing. | `clear` on failure |
| R7 | Low | Google link and verification or replacement can overwrite each other's password or sessions (no takeover). | Conditional link update; end sessions before the replacement |
| R8 | Minor | The race test rarely hits the guard it names; no `Promise.all` test for repeated sign-up and unverified sign-in. | Force the order with a spy; add the tests |
| R9 | Nit | Contract: a used code can answer `INCORRECT_CODE`; `EMAIL_FROM` not required with a key outside production; `runInBackground` not in try/catch; weak `codeHash` assertion; T013/T014 wording. | One-line fixes |
