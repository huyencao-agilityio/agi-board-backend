# Contract: Auth sign-up

Base path `/api/v1`. Errors use `{ error: { code, message, details } }`; clients branch on `code`. All three routes are `@Public()` and need the `csrf_token` cookie plus the `X-CSRF-Token` header (403 `CSRF_INVALID`). Emails are trimmed and lower-cased; unknown fields answer 400 `VALIDATION_FAILED`. Texts marked (proposed) are not on the card.

## POST /auth/sign-up

```json
{ "fullName": "Test User", "email": "user@example.com", "password": "..." }
```

| Case | Status | Body / `error.code` |
|------|--------|---------------------|
| New email | 201 | `{ "next": "verify-email" }`, no session cookie; a code is emailed |
| Email with a verified, Google-only or deactivated account | 409 | `EMAIL_ALREADY_EXISTS`, "An account with this email already exists. Sign in instead." (proposed); nothing is changed or sent |
| Email with an unverified password account | 201 | as a new email; password and full name are replaced, the old code is voided, a new one is emailed |
| Unverified email again within 60 seconds of the last sign-up or code | 201 | as a new email; nothing is changed or sent |
| Invalid email, password or full name | 400 | `VALIDATION_FAILED`, one `details` entry per failed rule |

Password: 8 to 128 characters, at least one letter and one number, not containing the part of the email before `@` (any letter case).

## POST /auth/verify-email

```json
{ "email": "user@example.com", "code": "123456", "password": "..." }
```

| Case | Status | Body / `error.code` |
|------|--------|---------------------|
| Right code | 200 | `{ "user": { "id", "email", "fullName", "systemRole" }, "next": "home" }`; `password` becomes the account password, other sessions end, session cookie set |
| Wrong, used or voided code, attempts 1 to 5 | 400 | `INCORRECT_CODE`, "Incorrect code." (proposed) |
| 6th attempt or later on the same code | 429 | `CODE_LOCKED`, "Too many attempts. Request a new code." (proposed) |
| Older than 10 minutes, or no code ever requested for the email | 400 | `CODE_EXPIRED`, "This code has expired. Request a new code." (proposed) |
| Right code, deactivated account | 403 | `ACCOUNT_DEACTIVATED` |
| Code not 6 digits, or the password breaks the sign-up rules | 400 | `VALIDATION_FAILED`, not counted as an attempt |

The frontend sends the password typed at sign-up or sign-in; after a page reload it asks for it again. A stored password from an earlier sign-up never survives verification.

The answers are the same for an email with no account or a verified one.

## POST /auth/resend-code

```json
{ "email": "user@example.com" }
```

| Case | Status | Body / `error.code` |
|------|--------|---------------------|
| No sign-up, resend or code for this email in the last 60 seconds | 200 | `{ "sent": true }`; a code is emailed only to an unverified password account, and the old one is voided |
| Within 60 seconds of the last one, whether or not the email has an account | 429 | `RESEND_TOO_SOON` |

`sent: true` is the generic answer, not proof that an email went out.

## POST /auth/sign-in (changed)

Correct password, unverified email: still 200 with `user` and `next: "verify-email"`, but **no session cookie**. A fresh code is emailed and the old one voided, at most once per 60 seconds. `/auth/me` answers 401 until the code is accepted.

## Google sign-up (unchanged)

`GET /auth/google`, see `specs/4/contracts/auth-sign-in.md`.

## Env (new)

`EMAIL_API_KEY` (secret) and `EMAIL_FROM`; optional outside production, required in production.
