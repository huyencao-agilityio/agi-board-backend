# Research: #18 Forgot Password

## R1 Cooldown of 60 seconds

- **Decision**: move `claim`, `restart` and `findRow` from `EmailVerificationService` to `SendCooldownService.claim(scope, email)`, used with `verify_email` and `reset_email`.
- **Rationale**: same rule, same race guards (conditional update, unique conflict); rows exist for unknown emails too. The `reset_email` scope is already in the enum.
- **Alternatives**: copy the code (two copies of a race guard); check the latest token's `created_at` (no row for unknown emails, racy).
- **Refused claim**: answer 200 and do nothing, so the earlier link stays valid.

## R2 Same answer and timing for every email

- **Decision**: every request claims and looks the user up. Issuing the link and sending the email run in `runInBackground`, which logs a failure with the user id and error class only.
- **Rationale**: voiding and creating a token are extra writes that would otherwise show in the response time. The runner is `waitUntil`, already used by `EmailService`.
- **Note**: the email send schedules a task from inside a background task. Confirmed with `wrangler dev` (2026-11-25); confirm on staging too.
- **Alternatives**: await the writes (measurable difference); dummy writes (more code and load).

| Account | Action |
|---------|--------|
| None, or deactivated | nothing |
| Active, has a password (Google-linked or unverified too) | void the live link, create a new one, email it |
| Active, no password (Google-only) | email the Google notice |

## R3 Token

- **Decision**: `newSessionToken()` and `hashSessionToken()` (32 random bytes, base64url; SHA-256). The link carries the token in the URL fragment; the API takes it in the POST body.
- **Rationale**: helpers already exist and match the security rule. A fragment never reaches server logs or `Referer`.
- **Alternatives**: query string (logged); a 6-digit code (not in the spec).

## R4 Applying the reset

- **Decision**: look the link up, check the password against the account's email, hash, then one `getBindings().DB.batch` of four statements, the first three guarded by "the link is still live and its user is active with a password": set `password_hash`, end open sessions (`password_reset`), delete the `sign_in` throttle row, and last mark the link used. The reset succeeded only if the last statement changed one row.
- **Rationale**: D1 runs a batch as one transaction and batches do not interleave, so two submits cannot both pass, and a failure changes nothing: the link stays usable.
- **Details**: every statement sees the live link because it is marked used last. Dates must be written as Prisma stores them (`toISOString()` with `Z` replaced by `+00:00`, confirmed in `@prisma/adapter-d1`). `updated_at` is set by hand. Values are bound parameters. The `sign_in` key comes from `throttleKey`.
- **Alternatives**: separate Prisma updates as in `verifyEmail` (a failure half-way can burn the link or leave old sessions open); `$transaction` (not atomic on D1).

## R5 Password rules

- **Decision**: `ResetPasswordDto` uses `@IsNewPassword()`; with no `email` field its email-name rule passes. The service then runs the existing `failedPasswordRules(password, user.email)` and answers 400 `VALIDATION_FAILED` with the same `details` list. The link is not used up.
- **Rationale**: the email must come from the link, never from the client.

## R6 Invalid links

- **Decision**: unknown, malformed, expired, used, voided, deactivated account, or account without a password (Google linking dropped it after the link was sent): one 400 `RESET_LINK_INVALID`.
- **Rationale**: decisions #45 and #46. The last case is inferred: a Google-only account has no reset (BRD §1).

## R7 Email verification

- **Decision**: the reset never touches `email_verified_at` (decision #42). `POST /auth/sign-in` already sends an unverified account to the code screen.
