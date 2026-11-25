# Data model: #5 User Sign Up

No new table or column. Schema edit: `AuthThrottleScope` gains `verify_email`.

## User (`users`)

| Field | Sign-up value | Rule |
|-------|---------------|------|
| `email` | trimmed, lower-cased | valid format, at most 254, unique |
| `fullName` | trimmed | at least one non-space character, no maximum |
| `passwordHash` | `PasswordService.hash` | rules in research R5; overwritten by the password sent with the accepted code |
| `emailVerifiedAt` | `null` | set when the code is accepted |

Existing email at sign-up:

| Account | Result |
|---------|--------|
| Verified, Google-only or deactivated | 409 `EMAIL_ALREADY_EXISTS`, nothing changes |
| Has a password, unverified and active | `passwordHash` and `fullName` replaced, old code voided, new code emailed; same response as a new sign-up |

## EmailVerificationCode (`email_verification_codes`)

| Field | Value |
|-------|-------|
| `codeHash` | SHA-256 of `<userId>:<code>` |
| `expiresAt` | creation + 10 minutes |
| `consumedAt` | set once when accepted |
| `voidedAt` | set when a newer code is issued |
| `failedAttempts` | stays 0 (research R3) |

States: live → consumed, voided or expired. At most one live code per user (`uq_email_verification_codes_live`).

## AuthThrottle (`auth_throttles`, scope `verify_email`)

| Field | Meaning |
|-------|---------|
| `subjectKey` | SHA-256 of the lower-cased email |
| `lastSentAt` | start of the window: cooldown ends at +60 s, code expires at +10 min |
| `failedCount` | attempts in this window, 0 to 5 |
| `lockedUntil` | unused |

| Event | Row absent | Row present |
|-------|------------|-------------|
| Sign-up, new or unverified email | create | restart if older than 60 s, else leave and send nothing (a new user is still created) |
| Resend, any email | create | restart if older than 60 s, else 429 |
| Sign-in, correct password, unverified | create | restart if older than 60 s, else leave |
| Verify attempt | `CODE_EXPIRED` | expired, locked, or count + 1 and compare |
| Verify accepted | n/a | kept (deleting it would show that the owner verified) |
