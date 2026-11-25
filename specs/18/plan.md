# Implementation Plan: #18 Implement feature Forgot Password

**Branch**: `feat/18-implement-feature-forgot-password` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/18/spec.md`

## Summary

Backend half of WEB-14 "Forgot password" and WEB-15 "Reset password". Adds three public endpoints to `modules/auth/`: `POST /auth/forgot-password`, `POST /auth/reset-password/check` and `POST /auth/reset-password`, and two emails (reset link, Google-only notice). The 60-second claim of email verification moves to a shared service and is reused.

Frontend-only criteria (opening WEB-14/WEB-15, live checklist, button states, sign-in notice) rely on [contracts/auth-password-reset.md](./contracts/auth-password-reset.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 tooling, NestJS 11, Prisma 7.10.1 (D1 adapter)

**Primary Dependencies**: existing only.

**Storage**: Cloudflare D1. Tables `password_reset_tokens`, `auth_throttles` (scope `reset_email`), `users`, `user_sessions`. All exist: no migration, no schema edit.

**Testing**: Jest unit and e2e (local D1). Email is faked at the provider boundary.

**Target Platform**: Cloudflare Workers.

**Project Type**: web-service (REST API).

**Performance Goals**: stay inside the Workers free-plan CPU limit (about 10 ms): one PBKDF2 derivation per reset, only after the link is found valid.

**Constraints**: same answer and similar timing for every email; CSRF on every write; no tokens or emails in API URLs or logs.

**Scale/Scope**: 3 endpoints, 2 emails, no env var (links use `APP_ORIGIN`).

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| `@Public()` with a why-comment, CSRF on public writes | Pass |
| Never reveal whether an email has an account, similar timing | Pass: one answer for all, account-specific work in the background (research R2) |
| Tokens: 32 random bytes, SHA-256 hash, expiry, single use | Pass. Looked up by the hash's unique index, as sessions are, so there is no secret to `timingSafeEqual` |
| Tokens never in URLs or query strings | Pass for the API (POST body). The emailed link carries it in the fragment, which browsers do not send (research R3) |
| Throttle via `auth_throttles`, 429 with a stable code | **Exception**: the second request within 60 seconds answers 200 (spec clarification, project owner) |
| Atomic multi-step writes through `DB.batch` | Pass (research R4) |
| Emails sent after the writes | Pass |
| Bound every string | **Exception**: `token` has no maximum, so every malformed link gets the same error (decision #46); the request body limit bounds it |
| Personal data only as far as the spec shows | Pass: the link check returns the email only to the holder of a live link |
| No new dependency | Pass |

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/18/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/auth-password-reset.md
└── tasks.md              # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/modules/
├── email/email.service.ts, .spec.ts                    # sendResetLink, sendGoogleSignInNotice
└── auth/
    ├── auth.module.ts                                  # new providers
    ├── auth.controller.ts                              # 3 routes
    ├── send-cooldown.service.ts                        # claim(scope, email), moved from EmailVerificationService
    ├── auth-errors.ts, session/session.service.ts, sign-in/sign-in.service.ts, sign-up/sign-up.service.ts  # review findings R1, R2
    ├── sign-up/email-verification.service.ts, .spec.ts # uses SendCooldownService; behavior unchanged
    ├── password-reset/password-reset.service.ts, .spec.ts
    └── dto/forgot-password.dto.ts, check-reset-link.dto.ts, reset-password.dto.ts
test/password-reset.e2e-spec.ts                         # new
```

**Structure Decision**: a `password-reset/` subfolder in `modules/auth/`, one per flow as in #51. `EmailVerificationService.claim(email)` stays as a one-line call so its callers do not change.

## Decisions

Project owner, 2026-11-25 (spec Clarifications): repeat within 60 seconds is a silent 200; a deactivated account gets nothing; the link check returns the email.

Confirmed by the project owner, 2026-11-25; the card includes the backend:

- **P1 Email texts**: no source gives them. See the contract.
- **P2 Link format**: `<APP_ORIGIN>/reset-password#token=<token>`. `/reset-password` is the existing frontend route.
- **P3 Codes**: one error, 400 `RESET_LINK_INVALID`, with the WEB-15 text.

## Risks and follow-ups

- **Link voiding and mail volume**: anyone can request a link for an email every 60 seconds, which voids the owner's earlier link and sends up to 1 440 emails a day. Same as #5 R4: needs a Cloudflare rate limit on `forgot-password` (client setup).
- **Background failure**: if issuing the link or the mail provider fails, the person still sees the Sent message and can retry after 60 seconds. WEB-14's Send failed state therefore covers network and server errors of the request only.
- **Failed link write**: voiding and creating a link are two statements, as in `issueCode`. If the second fails, the earlier link is dead and nothing is sent; a new request after 60 seconds recovers.
- **Unverified account**: sign-up again (decision #364) can overwrite a password just set by a reset. No access for the stranger; the owner signs up or resets again.
- **Lockout**: wrong sign-ins plus a reset request every 60 seconds can keep an owner locked out of password sign-in. The Cloudflare rate limit must be per IP and in place before production.
- **Frontend**: same card, frontend repository. It must read the token from the fragment and remove it from the address bar.
- **Card label**: the card has only the `Frontend` label; the project owner confirmed that it includes the backend.
- Support's "send reset link" (admin console) is another ticket.

## Review findings (code-reviewer and security-auditor, 2026-11-25)

No Critical or High finding, no account-takeover path. The raw SQL batch, tokens, enumeration and logging were checked.

| ID | Severity | Finding | Outcome |
|----|----------|---------|---------|
| R1 | Medium | An in-flight sign-in with the old password can survive the reset (`sign-in.service.ts`, existing code) | Fixed: after storing its session, sign-in reads the password hash again; changed means the session ends and the answer is `INVALID_CREDENTIALS` |
| R2 | Low | A live reset link survives `verify-email` replacing the password; using it needs the emailed link | Fixed: `verifyEmail` voids the live link. A link was already unusable after a successful reset; a test now covers earlier links too |
| R3 | Low | No test held the batch's `voided_at`, `expires_at` and lock guards | Fixed: e2e cases added |
| R4 | Low | Void and create of a link are not atomic | Recorded under Risks |
| R5 | Low | Sign-up again can undo a reset of an unverified account (#42 with #364) | Recorded under Risks |
| R6 | Low | Link voiding combined with the sign-in lock | Recorded under Risks |
| R7 | Low | A request body over the Express limit answers 500 on every route (existing) | Separate ticket |
