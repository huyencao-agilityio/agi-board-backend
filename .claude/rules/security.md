---
paths:
  - 'src/**/*.ts'
  - 'prisma/**'
  - 'test/**/*.ts'
---

# Security

Source: proposal §7 (Security NFR), risk R-02, and the guards already in `src/common/`. These rules are not optional; if a spec seems to need an exception, ask first.

## Authentication and sessions

- Every route needs a session by default (`SessionGuard`). `@Public()` only for routes a signed-out user must reach (sign-in, sign-up, verify, forgot/reset password, health). Each `@Public()` gets a one-line comment saying why.
- CSRF (`CsrfGuard`) stays on for every write, public routes included. Never skip it or add a bypass.
- Session cookie: `httpOnly: true`, `sameSite: 'lax'`, `secure` in production, `path: '/'`. The cookie holds a random token from `newSessionToken()`; only `hashSessionToken(token)` is stored. Logout is `POST` only and sets `endedAt`.
- Deactivated users (`deactivatedAt`) and ended sessions are rejected; keep that check when touching session code.

## Authorization (R-02)

- Every board/workspace permission decision goes through a pure function in `src/modules/permissions/` with a row in its table test. No inline role checks in services or controllers.
- System roles (`support`, `super_admin`) never grant access to workspace or board content. `@RequireSystemRole()` is for admin-console routes only.
- Hide existence: a user without view access gets 404, the same as for a missing id.
- Take the acting user from `@CurrentUser()` only. Never accept `userId`, `role`, `workspaceId` ownership or `systemRole` from the request body to decide access.

## Input and output

- All input goes through DTOs (`ValidationPipe` whitelists). Map DTO fields to Prisma `data` explicitly; do not spread request objects into `create`/`update`.
- Raw SQL only as tagged templates (`$queryRaw\`... ${value}\``). Never `$queryRawUnsafe`/`$executeRawUnsafe` with any value that came from a request.
- Responses use explicit `select`. Never return `passwordHash`, `tokenHash`, `codeHash`, session tokens, reset tokens or verification codes.
- Errors never echo stack traces, SQL or Prisma messages; `AllExceptionsFilter` already maps unknown errors to 500 `INTERNAL_SERVER_ERROR`. Do not bypass it with `res.status().send()`.

## Secrets, tokens and passwords

- Secrets come from `ConfigService` (validated in `envSchema`); never hard-code them, never commit `.env`, never log them.
- Tokens and codes (session, password reset, email verification, invites): generate with `randomBytes(32)` (6-digit codes with `randomInt`), store only a SHA-256 hash, compare with `timingSafeEqual`, give them an expiry and single use (`usedAt` / `voidedAt`).
- Passwords: hash with argon2id (decided for Sprint 1; do not use bcrypt/SHA). Use a WebAssembly build: the native `argon2` package cannot load on Workers. Pick parameters that fit the Worker CPU limit and measure them. Never log or return a password or hash.

## Account privacy and abuse

- Never reveal whether an email has an account: sign-up, sign-in failure, forgot password and lockout return the same response and status for every address, with similar timing.
- Lockout after repeated failed sign-ins (proposal default: 5 failures, 15 minutes) via the `auth_throttles` table; return 429 with a stable code. Throttle other abuse-prone public endpoints (resend code, forgot password) the same way.

## Personal data

Personal data in this schema: `users.email`, `users.full_name`, `users.avatar_object_key`, `users.google_subject`, `user_sessions.ip_address`, `user_sessions.user_agent`, `invites.email` (people who may not have an account yet), and user-written content (card titles/descriptions, comments, checklist items, attachments). Before a change that reads, returns, stores, logs or sends any of these, check the rules below.

- Minimise: do not add a column, response field or log line holding personal data unless the spec needs it. Return another user's data only as far as the spec shows it (e.g. name and avatar of fellow members).
- Never put emails, tokens or codes in URLs or query strings: `pino-http` logs `req.url`. Send them in a `POST` body.
- `ip_address` and `user_agent` are shown only to their owner (the active-sessions list); no other endpoint returns them.
- Admin-console and support endpoints return account fields only, never workspace/board content (CH-03).
- Audit-log `details` hold ids and action data, not copies of content or other people's emails: audit rows are kept forever.
- Personal data in error `details`, emails and notifications: only what the recipient is already allowed to see.
- Tests and seeds use fake data only (`@e2e.test`, `example.com`); never real addresses.
- Retention, account deletion vs deactivation, and who may see members' emails are not decided in the BRD: ask instead of choosing.

## Logging and audit

- Log ids, not personal data: no emails, names, tokens, cookies, passwords or request bodies. pino already redacts cookie/authorization headers; keep that list when changing the logger.
- Admin and security-relevant actions write an `audit_log_entries` row in the same transaction as the change. Audit rows are never updated or deleted by application code.

## Attachments (Sprint 4)

- Max 25 MB per file, enforced server-side before storing. Do not trust the client MIME type or filename: generate the object key, sanitise the display name, serve downloads with `Content-Disposition: attachment` and only after the board-view permission check.

## Dependencies

- Do not add a dependency for something a few lines or an installed package can do. New dependencies need an exact reason in the PR. Keep `prisma` and `@prisma/client` on the same exact version.
