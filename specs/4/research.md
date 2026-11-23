# Research: #4 User Sign In

## R1 Password hashing on Workers

- **Decision (changed 2026-11-23)**: PBKDF2-SHA256 through WebCrypto, `PASSWORD_PBKDF2_ITERATIONS` default 10 000, stored as `$pbkdf2-sha256$i=<n>$<salt>$<hash>`. This is a **knowing exception** to the security rule "argon2id", accepted by the project owner because the Cloudflare account is on the Workers **free plan**.
- **Why**: free-plan Workers allow about 10 ms CPU per request (to be confirmed against current Cloudflare docs). Measured in workerd on the dev machine: argon2id (`@noble/hashes`, pure JS) m=19456 t=2 took 275 to 292 ms; PBKDF2-SHA256 600 000 iterations 267 ms; scrypt N=2^15 75 ms (N=2^17, the OWASP minimum, needs about 128 MB, the Worker memory limit). Nothing at OWASP strength fits 10 ms. PBKDF2 costs about 0.45 ms per 1 000 iterations, so 10 000 iterations is about 4.5 ms, leaving room for the rest of the request.
- **Security consequence**: 10 000 iterations is 60x below the OWASP figure (600 000). Stolen hashes of weak passwords would fall quickly to GPU cracking. Sign-in lockout (5 tries / 15 min) limits online guessing only.
- **Unverified**: the 10 000 figure is not tested on the real free plan. The whole request (Nest, Prisma, hashing) may exceed 10 ms and return Cloudflare error 1102. First thing to do on staging: sign in and watch for 1102; lower or raise `PASSWORD_PBKDF2_ITERATIONS` (a `vars` entry in `wrangler.jsonc`) accordingly.
- **Upgrade path**: on a paid plan, switch `PasswordService.hash` to argon2id (the earlier spike used `@noble/hashes` 2.4.0, m=19456 t=2 p=1, about 0.3 s) and rehash at sign-in when the stored algorithm or iteration count is outdated. `verify` already reads the algorithm and cost from the stored string. Not built now.
- **Alternatives considered**: argon2id pure JS (too slow for free plan; kept as the upgrade path), bcrypt (rejected by the rules), `hash-wasm` (wasm compiled from bytes is blocked on Workers).

## R2 Google sign-in

- **Decision**: authorization-code flow with PKCE, written with `fetch`. `GET /auth/google` sets a short-lived httpOnly cookie holding `state` and the PKCE verifier and redirects to Google. The callback checks `state`, exchanges the code at Google's token endpoint over TLS, then checks the id_token claims: `iss`, `aud` = our client id, `exp`, `email_verified = true`.
- **Rationale**: the id_token arrives directly from Google over TLS in the code exchange, so claims can be validated without fetching JWKS. No OAuth library needed (rule: no dependency for a few lines; `backend-init-plan.md` also defers OAuth libraries).
- **Alternatives**: `google-auth-library` (Node-oriented, heavy for Workers); `passport-google-oauth20` (Express/passport, extra layer).
- **Account merge**: look up by `google_subject`, else by lower-cased email and link `google_subject` (no message, per spec), else create a user. Google already verified the email, so `email_verified_at` is set if empty.
- **Decline / failure**: `error=access_denied` redirects to sign-in with no parameter (default state, no message). Any other failure redirects with `error=google_failed` so the frontend shows "Google sign-in failed. Try again.".

## R3 Lockout

- **Decision**: `auth_throttles` row with `scope = sign_in` and `subject_key = sha256(lower-cased email)`. Check before verifying the password; a locked attempt returns 429 and does not increment. 5th consecutive failure sets `locked_until = now + 15 min`. Success deletes the row.
- **Rationale**: the table and enum value already exist. Hashing the key keeps emails out of a table the rules treat as personal data. Rows are created for unknown emails too, so lockout cannot be used to probe accounts.
- **Race**: two parallel wrong passwords may both read the same count. Use a single atomic `UPDATE ... SET failed_count = failed_count + 1` via `$executeRaw` tagged template, then read back. Covered by a `Promise.all` e2e test as the testing rules ask.

## R4 Same response for unknown and known accounts

- **Decision**: for an unknown email, or an account with no password hash (Google-only), verify the password against a fixed dummy argon2 hash so timing is similar, then return the same 401 `INVALID_CREDENTIALS`.
- **Rationale**: spec and `security.md` require identical text and "similar timing".

## R5 Session expiry and signed-out notice

- **Decision**: idle expiry. A session whose `last_active_at` is older than `SESSION_IDLE_DAYS` (default 7, proposed) is ended by `SessionGuard` with `end_reason = expired`. The guard then throws 401 `SESSION_ENDED`. The same code is used for sessions ended by an admin or by a password change/reset; only `logout` keeps a plain 401, so a normal log out shows no notice. The frontend answers `SESSION_ENDED` by signing the user out locally and showing the sign-in form with "You were signed out. Sign in again." (proposed).
- **Sliding window**: the guard refreshes `last_active_at` only when it is more than 1 hour old, to avoid a D1 write on every request. The session cookie gets `maxAge = SESSION_IDLE_DAYS` days, renewed on the same refresh.
- **Schema**: add `expired` to `SessionEndReason`. D1 does not enforce enums (see AGENTS.md), so no SQL is needed; run `pnpm db:check` to confirm Prisma produces no migration diff. If it does produce one, stop and ask.
- **Why not an absolute limit**: it would need a new `expires_at` column and a migration; idle expiry reuses an existing column.
- **Check before changing the guard**: existing e2e tests that assert 401 bodies.
- **Why the 7 days**: a proposal, not from the BRD. Confirm with the client (same status as the other "proposed" values in confirmations C-17).

## R6 Unverified email

- **Decision**: correct credentials with `email_verified_at IS NULL` still create a session and return `next: "verify-email"` (frontend goes to WEB-16, no error). The session is needed so WEB-16 knows who is verifying.
- **Open**: nothing blocks unverified users elsewhere yet. Later tickets (verification, boards) decide that gate.
