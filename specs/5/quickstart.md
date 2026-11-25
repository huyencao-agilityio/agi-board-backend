# Quickstart: #5 User Sign Up

Contract: [contracts/auth-sign-up.md](./contracts/auth-sign-up.md). Data rules: [data-model.md](./data-model.md).

## Setup

```bash
pnpm mail:up           # Mailpit, inbox at http://localhost:8025
pnpm start:dev         # http://localhost:8787/api/v1
```

Leave `EMAIL_API_KEY` unset so emails go to Mailpit.

## Manual check

```bash
API=http://localhost:8787/api/v1
curl -s -c jar $API/health > /dev/null                  # any GET sets csrf_token
CSRF=$(awk '$6=="csrf_token"{print $7}' jar)
post() { curl -s -i -b jar -c jar -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d "$2" $API$1; }

post /auth/sign-up '{"fullName":"Test User","email":"new@example.com","password":"abcd1234"}'
post /auth/verify-email '{"email":"new@example.com","code":"<code from Mailpit>","password":"abcd1234"}'
curl -s -b jar $API/auth/me
```

## Scenarios

| # | Do | Expect |
|---|----|--------|
| 1 | Sign up, read the code, verify | 201 without `agi_sid`; 200 with `agi_sid`; `/auth/me` says `home` |
| 2 | Password `short1`, `abcdefgh`, or containing the email name | 400 `VALIDATION_FAILED` naming the rule |
| 3 | Full name of spaces only | 400 `VALIDATION_FAILED` |
| 4 | Sign up again with the same unverified email and a new password: at once, then after 60 seconds | The same 201 both times; the first changes and sends nothing, the second sends a new code; no second user; after verifying, only the password sent with the code signs in |
| 5 | Sign up with a Google-only email | 409 `GOOGLE_ONLY_EMAIL` |
| 6 | Wrong code 5 times, then the right one | 5 × `INCORRECT_CODE`, then 429 `CODE_LOCKED` |
| 7 | Scenario 6, then sign up again within 60 seconds | 201; still locked until a new code is sent |
| 8 | Resend at once, then after 60 seconds | 429 `RESEND_TOO_SOON`, then 200; the old code fails |
| 9 | Code after 10 minutes | 400 `CODE_EXPIRED` |
| 10 | Scenarios 4 and 6 to 9 on a verified email | Same statuses and bodies except that no code is ever right; no code email, password unchanged |
| 11 | Sign in before verifying | 200 `next: verify-email`, no cookie, fresh code if 60 seconds passed |
| 12 | 20 parallel wrong codes; 2 parallel sign-ups | At most 5 checked; one user |

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm db:check
```

On staging: confirm the code email arrives (background sending, research R2) and that sign-up does not hit the CPU limit (error 1102).
