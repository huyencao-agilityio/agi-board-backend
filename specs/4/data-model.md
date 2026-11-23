# Data Model: #4 User Sign In

No SQL migration. All tables exist in `prisma/schema/auth.prisma`; this feature reads and writes them as below. The only schema edit is the new `expired` value of `SessionEndReason` (`enums.prisma`), which D1 does not enforce.

## users (read, and write on Google link / sign-in)

| Field | Use here |
|-------|----------|
| `email` | lookup key, always lower-cased and trimmed |
| `passwordHash` | PHC argon2id string; `NULL` for Google-only accounts, which cannot sign in with a password |
| `googleSubject` | set when a Google sign-in links or creates the account; unique |
| `emailVerifiedAt` | `NULL` → response `next: "verify-email"`; set from Google when its email is verified |
| `deactivatedAt` | non-null → sign-in refused (see contract) |
| `lastSignInAt` | set on every successful sign-in |
| `fullName` | for a Google-created user, from the id_token `name` (falls back to the email local part) |

## user_sessions (write)

One row per successful sign-in: `tokenHash = hashSessionToken(token)`, `userAgent`, `ipAddress`, `lastActiveAt` default. The raw token only goes into the cookie. Ended sessions carry `endedAt` + `endReason` (CHECK: both set or both null); `lastActiveAt` older than `SESSION_IDLE_DAYS` (7) ends the session with `endReason = expired` on the next request. `SESSION_ENDED` is raised for any end reason except `logout`.

## auth_throttles (read and write)

`scope = sign_in`, `subjectKey = sha256(lower-cased email)`, `failedCount`, `lockedUntil`.

State transitions:

```text
none ──wrong password──▶ failedCount 1..4 ──5th wrong──▶ locked (lockedUntil = now + 15 min)
  ▲                          │ success                         │ lockedUntil passes: next attempt starts again at 1
  └──────── row deleted ◀────┘                                 │ reset(email) (password reset ticket): row deleted
```

While `lockedUntil > now`, attempts return 429 and change nothing.

## Validation rules (DTO)

- `email`: trim, lower-case, `@IsEmail`, `@MaxLength(254)`. Any domain is accepted.
- `password`: string, `@MaxLength(128)` to bound hashing cost, no strength rules at sign-in.
- Unknown fields rejected by the global `ValidationPipe`.
