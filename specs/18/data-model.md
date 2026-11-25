# Data model: #18 Forgot Password

No new table, column, enum value or migration.

## PasswordResetToken (`password_reset_tokens`)

| Field | Value |
|-------|-------|
| `tokenHash` | SHA-256 of the token, unique |
| `expiresAt` | creation + 30 minutes |
| `usedAt` | set once, in the reset batch |
| `voidedAt` | set when a newer link is issued |

States: live → used, voided or expired. At most one unused, unvoided link per user (`uq_password_reset_tokens_live`). A link is valid when it is live, not expired, and its user is active and has a password.

Two parallel issues for one user: the loser hits the unique index and sends nothing.

## AuthThrottle (`auth_throttles`)

| Scope | Use |
|-------|-----|
| `reset_email` | `lastSentAt`: start of the 60-second window; key is the SHA-256 of the lower-cased email; kept for every email requested |
| `sign_in` | row deleted by a successful reset (lifts the lock, decision #31) |

| Forgot-password request | Row absent | Older than 60 s | Within 60 s |
|-------------------------|------------|-----------------|-------------|
| Any email | create, proceed | restart, proceed | 200, do nothing |

## User and UserSession, on a successful reset

| Field | Change |
|-------|--------|
| `users.password_hash` | new hash |
| `users.email_verified_at` | unchanged |
| `user_sessions.ended_at`, `end_reason` | set on every open session, `password_reset` |

Password: 8 to 128 characters, a letter, a number, not containing the email name (`password-rules.ts`).
