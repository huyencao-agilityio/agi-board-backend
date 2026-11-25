# Research: #5 User Sign Up

## R1 Email sending

- **Decision**: `POST https://api.resend.com/emails` with `fetch` and `Authorization: Bearer <EMAIL_API_KEY>`. Without a key outside production, post to Mailpit's HTTP API (`http://localhost:8025/api/v1/send`). `EMAIL_FROM` holds the sender.
- **Rationale**: Workers cannot use SMTP (`AGENTS.md`); one request does not need an SDK. Mailpit is already in `docker-compose.yml`.
- **Alternatives**: Brevo (offered, not chosen); Resend SDK (a dependency for one request).
- **Failures**: logged with the user id and the error class or HTTP status only. The request still succeeds and the user taps Resend.

## R2 Background sending

- **Decision**: send through `waitUntil` from `cloudflare:workers`, passed in by `edge/src/index.mjs` through `src/cloudflare.ts`. Tests supply a hook that collects the promises so they can await them.
- **Rationale**: resend mails only unverified accounts, so waiting for the provider would reveal them through timing. A plain un-awaited promise may be cancelled when the response ends.
- **To verify**: `waitUntil` inside `httpServerHandler`, with `wrangler dev` and on staging.

## R3 No account leak in verification

- **Decision**: no session at sign-up; verify and resend take the email in the POST body. One `auth_throttles` row (`scope = verify_email`, key = SHA-256 of the lower-cased email) drives attempts, expiry and cooldown for every email, with or without a real code.
- **Rationale**: a cookie at sign-up, or limits kept only on real codes, would tell new emails from existing ones.
- **Consequence**: `email_verification_codes.failed_attempts` stays 0; the throttle row is the only counter.
- **Row rules**: sign-up, resend and sign-in (correct password, unverified) share one claim for every email, with or without an account: create the row when absent, restart it when older than 60 seconds, else refuse. Refused: sign-up and sign-in answer normally and send nothing, resend answers 429. A new user is created even when refused and gets a code by resending. Tries are only refilled together with a new window. The row is never deleted.
- **Existing-account notice**: sent only to verified or deactivated accounts and only when the claim succeeded, so one address gets at most one per 60 seconds.
- **Timing**: the password is hashed before the email lookup in every case.
- **Alternatives**: a signed verification cookie (more state, breaks across devices); counting on the code row (leaks).

## R4 Races and partial failures

- **Attempts**: one conditional `updateMany` (count below 5, not expired) increments before the code is compared. As in `SignInThrottleService`, parallel guesses get at most 5 checks.
- **Cooldown**: one conditional `updateMany` on `last_sent_at`; only the winner issues a code.
- **Parallel sign-ups**: the unique email decides. Only the request that won the claim sends a code, whichever of them created the user.
- **Password at verification**: one conditional `updateMany` (unverified, active, has a password) sets the verified time and the password sent with the code, so the order of earlier sign-ups does not matter; then all open sessions end. Sign-up again only updates the waiting account.
- **Google link**: conditional on the values read; if a verification runs at the same time the person retries.
- **Single use**: consuming the code is a conditional update; only the winner verifies and gets a session.
- **Crash between steps**: at worst an unverified account without a live code; resend or sign-in issues one.

## R5 Password rules

- **Decision**: at least 8 characters, a letter (`\p{L}`), a digit (`\d`), and not containing the part of the email before `@`, case-insensitively. Maximum 128, the sign-in cap. Each failed rule is its own entry in `error.details`.
- **Note**: a one-letter email name rejects any password with that letter; this is the literal BRD rule.

## R6 Wrong-attempt boundary

- **Decision**: wrong attempts 1 to 5 answer `INCORRECT_CODE`; the 6th attempt answers `CODE_LOCKED`, even with the right code.
- **Rationale**: the card says the 6th try is blocked.
