# Contract: Auth password reset

Base path `/api/v1`. Errors use `{ error: { code, message, details } }`; clients branch on `code`. All three routes are `@Public()` and need the `csrf_token` cookie plus the `X-CSRF-Token` header (403 `CSRF_INVALID`). Unknown or missing fields answer 400 `VALIDATION_FAILED`. Texts marked (proposed) are not on the card.

## POST /auth/forgot-password

```json
{ "email": "user@example.com" }
```

The email is trimmed and lower-cased.

| Case | Status | Body | Email sent |
|------|--------|------|------------|
| Active account with a password, verified or not | 200 | `{ "sent": true }` | reset link; the earlier link is voided |
| Google-only account | 200 | same | Google notice |
| Unknown email or deactivated account | 200 | same | none |
| Any email, within 60 seconds of the last accepted request | 200 | same | none; the earlier link stays valid |
| Invalid email | 400 | `VALIDATION_FAILED` | none |

`sent: true` is the generic answer, not proof that an email went out.

## POST /auth/reset-password/check

```json
{ "token": "..." }
```

| Case | Status | Body / `error.code` |
|------|--------|---------------------|
| Valid link | 200 | `{ "email": "user@example.com" }`; the link is not used up |
| Malformed, unknown, expired, used or voided link; account deactivated or without a password | 400 | `RESET_LINK_INVALID`, "This link has expired or was already used." (proposed), no account data |

## POST /auth/reset-password

```json
{ "token": "...", "password": "..." }
```

| Case | Status | Body / `error.code` |
|------|--------|---------------------|
| Valid link and password | 200 | `{ "next": "sign-in" }`, no session cookie. Password replaced, link used, every session ended (`SESSION_ENDED`), sign-in lock lifted, email verification unchanged |
| Invalid link, including one that expires or is used while the form is open | 400 | `RESET_LINK_INVALID` |
| Password breaks the rules | 400 | `VALIDATION_FAILED`, one `details` entry per failed rule; the link stays valid |

The email-name rule is checked against the account's email after the link is found valid, so it answers apart from the other rules. A new password equal to the old one is accepted.

## Emails (texts confirmed by the project owner, 2026-11-25)

**Reset link**. Subject: `Reset your AGI Board password`

```text
Open this link to set a new password:

<APP_ORIGIN>/reset-password#token=<token>

It is valid for 30 minutes and can be used once. If you did not ask for it, ignore this email.
```

**Google-only notice**. Subject: `Sign in to AGI Board with Google`

```text
Someone asked to reset the password for this email. Your account uses Google sign-in and has no password.

Use Continue with Google at <APP_ORIGIN>/sign-in. If you did not ask for it, ignore this email.
```
