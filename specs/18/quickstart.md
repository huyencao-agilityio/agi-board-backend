# Quickstart: #18 Forgot Password

Contract: [contracts/auth-password-reset.md](./contracts/auth-password-reset.md). Data rules: [data-model.md](./data-model.md).

## Setup

```bash
pnpm mail:up           # Mailpit, inbox at http://localhost:8025
pnpm start:dev         # http://localhost:8787/api/v1
```

Leave `EMAIL_API_KEY` unset so emails go to Mailpit. Have a verified password account (see [../5/quickstart.md](../5/quickstart.md)).

## Manual check

```bash
API=http://localhost:8787/api/v1
curl -s -c jar $API/health > /dev/null                  # any GET sets csrf_token
CSRF=$(awk '$6=="csrf_token"{print $7}' jar)
post() { curl -s -i -b jar -c jar -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d "$2" $API$1; }

post /auth/forgot-password '{"email":"new@example.com"}'
post /auth/reset-password/check '{"token":"<token from Mailpit>"}'
post /auth/reset-password '{"token":"<token>","password":"wxyz5678"}'
post /auth/sign-in '{"email":"new@example.com","password":"wxyz5678"}'
```

## Scenarios

| # | Do | Expect |
|---|----|--------|
| 1 | Request, check, reset, sign in | 200 each; `check` gives the email; the old password no longer signs in |
| 2 | Request for unknown, deactivated and Google-only emails | Same status and body as scenario 1; only the Google-only address gets an email, the notice |
| 3 | Request twice at once, then after 60 seconds | 200 every time; one email, then a second one; the first link works until the second is sent |
| 4 | Use a link again; use a voided, expired (30 min), unknown or malformed one | 400 `RESET_LINK_INVALID` on both routes; password unchanged |
| 5 | Deactivate the account after the link is sent | 400 `RESET_LINK_INVALID`; password unchanged |
| 6 | Weak password, or one containing the email name | 400 `VALIDATION_FAILED`; the link still works afterwards |
| 7 | Reset with two signed-in sessions | Both answer 401 `SESSION_ENDED` |
| 8 | Lock sign-in with 5 wrong passwords, then reset | Sign-in with the new password works at once |
| 9 | Reset an unverified account, then sign in | Still unverified; sign-in says `verify-email` |
| 10 | Two parallel resets with one link | One 200, one 400; the winner's password signs in |
| 11 | Same new password as the old one | 200 |
| 12 | Email with spaces and capitals | Treated as the same address, also for the 60 seconds |
| 13 | Any route without the CSRF header | 403 `CSRF_INVALID` |

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm db:check
```

On staging: confirm both emails arrive (nested background sending, research R2) and that a reset does not hit the CPU limit (error 1102).
