# Data model: #51 Refactor auth module structure

No entity, column, enum or migration changes; `pnpm db:check` must report no difference.

Tables used, with the service that writes them after the split:

| Table | Written by |
|-------|------------|
| `users` | `SignUpService`, `GoogleSignInService`, `SessionService` (`lastSignInAt`) |
| `user_sessions` | `SessionService` (create); `SignUpService` and `GoogleSignInService` (end existing sessions) |
| `email_verification_codes` | `EmailVerificationService` |
| `auth_throttles` | `SignInThrottleService` (`sign_in`), `EmailVerificationService` (`verify_email`) |

`throttleKey` must give the same key as today (SHA-256 hex of the lower-cased email), or existing locks and cooldowns are lost.
