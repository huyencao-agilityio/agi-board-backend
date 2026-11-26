# Research: #22 Profile and Account Settings (backend)

Decisions taken while planning. Clarifications Q1–Q5 in `spec.md` are inputs, not repeated here.

## D1. Where the routes live

- **Decision:** a new `users` module for the profile (`GET`/`PATCH /users/me`, avatar under `/users/me/avatar`). Password change and sessions stay in the `auth` module (`POST /auth/change-password`, `/auth/sessions`), next to `PasswordService`, `SessionService` and the throttle they reuse.
- **Rationale:** no service has to be exported across modules (`nestjs.md`: export only when another module needs it). Password and sessions are auth concerns already owned by `auth`; name and avatar are user data.
- **Alternatives:** everything under `/users/me/*` in `users` (needs `AuthModule` to export `PasswordService`, `SessionService` and the throttle); everything in `auth` (`/auth/profile` mixes user data into auth).

## D2. Avatar upload format

- **Decision (approved 2026-11-26):** `PUT /users/me/avatar` with `multipart/form-data`, one file field named `file` (the frontend sends a `FormData`). Two steps:
  1. The service reads the request stream itself: `for await (const chunk of req)`, adding up the bytes, and stops with 413 `PAYLOAD_TOO_LARGE` as soon as the total passes `AVATAR_BODY_LIMIT` = 5 MB + 64 KB (room for the multipart boundary and part headers). An oversized body is never held in memory (a Worker has ~128 MB). Only the avatar route reads its body this way; no global parser and no `app.setup.ts` change. (`express.raw` was dropped: `express`/`body-parser` are not direct dependencies, pnpm does not hoist them, so `src/` cannot import them without adding a dependency.)
  2. The service parses the collected Buffer with the platform's own parser: `await new Response(body, { headers: { 'content-type': req.get('content-type') } }).formData()`, then `form.get('file')` must be a `File`. Its `size` must be ≤ 5 MB; its magic bytes decide the type (the part's `type` and file name come from the client and are ignored). The **detected** type is stored.
- **Rationale:** multipart is the usual upload format (FormData on the frontend, documented in Swagger, the same shape attachments will use in Sprint 4). Parsing with the Web `Response.formData()` (native in Workers and Node) avoids Multer/busboy on Node streams, which are untested on Workers here. `request.formData()` of a plain Worker is not reachable from a Nest controller, which only gets Express's `req`. Reading the stream in the avatar service keeps its 5 MB limit away from other routes (attachments will have their own). Magic-byte check follows the "do not trust the client MIME type" rule in `security.md`.
- **Alternatives:** raw image body (`PUT` with `Content-Type: image/*`): simplest, but not the usual shape and differs from attachments later; Multer `FileInterceptor` (already installed with `@nestjs/platform-express`): busboy streams untested on Workers; presigned R2 upload URLs: needs R2 S3 credentials and a second "confirm" call, and the size/type check would happen after storing; R2 remote binding for local dev: not allowed (remote D1/R2 only from CI), local and e2e use the local bucket in `.wrangler/`.
- **To verify first:** on `wrangler dev`, reading `req` with `for await` inside a Nest controller, and `new Response(buffer).formData()` on the result (first implementation task).
- **Signatures:** JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; GIF `GIF87a` / `GIF89a`; WebP `RIFF????WEBP`. JPG is the same format as JPEG (`image/jpeg`).

## D3. Body too large / wrong type

- **Decision:** `AllExceptionsFilter` maps body-parser errors (they carry `expose: true` and a 4xx `status`, e.g. `type: 'entity.too.large'` → 413) to that status with the standard envelope. This is for Nest's JSON parser on all routes; the avatar route throws its own `PayloadTooLargeException`. Avatar errors: 413 `PAYLOAD_TOO_LARGE` when the body passes 5 MB + 64 KB or the file is over 5 MB; 415 `UNSUPPORTED_IMAGE_TYPE` when the bytes do not match JPEG/PNG/WebP/GIF; 400 `VALIDATION_FAILED` when the request is not `multipart/form-data`, cannot be parsed, or has no non-empty `file` field.
- **Rationale:** today any body-parser error (also a JSON body over 100 kB) ends as 500 `INTERNAL_SERVER_ERROR` because it is not an `HttpException`. The filter fix is a few lines and fixes both.

## D4. Avatar storage and serving

- **Decision:** object key `avatars/<userId>/<random uuid>` in the `IMAGES` bucket, stored with the detected `contentType`; `users.avatar_object_key` holds the key (no schema change). The image is served by `GET /users/me/avatar` (session required, owner only), read from R2 into a Buffer (`Buffer.from(await obj.arrayBuffer())`, ≤ 5 MB; `StreamableFile` does not take R2's Web `ReadableStream` and `Readable.fromWeb` is untested on Workers) and sent with `Content-Type`, `Cache-Control: private, max-age=31536000, immutable` and `Cross-Origin-Resource-Policy: same-site` (helmet's default `same-origin` would block the frontend on another port/subdomain of the same site). The profile returns `avatarUrl: "/api/v1/users/me/avatar?v=<key's uuid>"`, so a new photo gets a new URL. `v` is the random uuid of the key, unique system-wide (not a per-user counter), and `GET` serves the image **only when `v` equals the current key's uuid** (404 otherwise, also without `v`). The path `/users/me/avatar` is the same for everyone and the server answers by cookie, so without this check one URL could return different users' photos and the browser would cache the wrong one for a year (e.g. a stale URL after switching accounts on a shared computer).
- **Same-site requirement:** the session cookie is `SameSite=Lax`, so a browser sends it with `<img>` only when the frontend and the API are on the same site. True today: staging and production serve both from one host (`APP_ORIGIN` = API host), and `localhost:5173` / `localhost:8787` are the same site. If they are ever split across sites, the whole cookie session stops working (Lax cookies are not sent on cross-site `fetch` either), not only avatars.
- **Rationale:** the bucket has no public domain; serving through the Worker keeps the session check. A new key per upload avoids caching an old photo under the same URL.
- **Out of scope:** only the owner changes and views their avatar here. Other users' name + avatar are returned by other APIs (e.g. card members), but the browser still needs a place to load those image bytes: either `GET /users/:id/avatar` with a permission rule ("shares a workspace/board", R-02) or a public domain for the `avatars/` prefix (keys hold a random uuid). That is decided in the ticket of the feature that shows them; the key format here works for both.

## D5. Replace/remove order (Q5)

- **Decision:** upload: check bytes → `IMAGES.put(newKey)` → `updateMany({ where: { id, avatarObjectKey: oldKey }, data: { avatarObjectKey: newKey } })` → delete the old key. If the conditional update matches no row (a parallel upload or remove changed the avatar meanwhile), the new object is deleted and the answer is 409 `AVATAR_CONFLICT`, so parallel uploads cannot leave unreferenced objects (security review M1: they could be used to fill the bucket). Remove: conditional `avatarObjectKey = NULL` on the same old key → delete the old key only if that update matched. A failed R2 delete is logged with the user id and key only (`warn`), the request still succeeds. If the DB update throws after the put, the new object is deleted (best effort) and the error goes up (500). A declared `Content-Length` over the body limit is refused with 413 before the body is read.

## D6. Change password

- **Decision:** `POST /auth/change-password` `{ currentPassword, newPassword }` → 204. Steps: load user (`passwordUserSelect`); no `passwordHash` → 400 `PASSWORD_NOT_SET`; count the attempt in the throttle (D7) → locked → 429 `CHANGE_PASSWORD_LOCKED`; verify `currentPassword` → wrong → record failure, 400 `CURRENT_PASSWORD_INCORRECT`; right → reset the throttle (as sign-in does, so weak new passwords never lock the owner out; code review H1); `failedPasswordRules(newPassword, user.email)` plus "differs from the current password" → 400 `VALIDATION_FAILED` with one `details` entry per rule (same as reset); hash; then one `DB.batch`:
  1. `UPDATE users SET password_hash = new WHERE id = ? AND password_hash = verifiedHash`
  2. `UPDATE user_sessions SET ended_at, end_reason = 'password_changed' WHERE user_id = ? AND id <> currentSessionId AND ended_at IS NULL AND EXISTS (users row now has the new hash)`
  3. `UPDATE password_reset_tokens SET voided_at = now WHERE user_id = ? AND used_at IS NULL AND voided_at IS NULL AND EXISTS (users row has the new hash)`: a reset link issued before the change would otherwise still replace the new password within its 30 minutes (security review H1)
  If statement 1 changed no row (password replaced meanwhile by a reset or another change) → 400 `CURRENT_PASSWORD_INCORRECT`.
- **Rationale:** all-or-nothing on D1 needs `DB.batch` (Prisma `$transaction` is not atomic there), same pattern as `PasswordResetService.applyReset`. The current session stays signed in; the others get `SESSION_ENDED` from `SessionGuard` (end reason is not `logout`). 400 rather than 401 for a wrong current password, so the frontend does not treat it as "signed out".
- **Same as current (PO, 2026-11-26):** a new password equal to the current one adds `password must differ from the current password` to the rule list (400 `VALIDATION_FAILED`). Compared as plain strings after the current password is verified, so no extra PBKDF2 run; checked before hashing, so it also saves one.
- **CPU risk:** a successful change runs PBKDF2 twice (verify + hash), about 2 × 4.5 ms at 10 000 iterations (specs/4/research.md R1), close to the free plan's ~10 ms CPU per request before Nest and Prisma. Reset and sign-in run it once. Check on staging after deploy (change a password, watch for Cloudflare error 1102); if it fails, lower `PASSWORD_PBKDF2_ITERATIONS` or move to the paid plan, as R1 says for sign-in.

## D7. Wrong current-password throttle (Q4)

- **Decision:** reuse `SignInThrottleService`'s logic (count before verify, atomic increment, lock 15 min after 5 failures) by giving its methods a `scope` argument (`'sign_in' | 'change_password'`), and keying `change_password` rows by the **user id** (`throttleKey('change_password', userId)`). The `change_password` scope already exists in `AuthThrottleScope`. The sign-in lock is never touched, so sign-in keeps working (Q4: account not locked). `attempt()` first zeroes an unlocked row whose last attempt is older than 15 minutes (conditional `updateMany`), so failures do not add up for months (code review M1; also applies to sign-in). The window slides from the last attempt.
- **Rationale:** the logic is exactly what Q4 asks for; a second copy would drift. Keying by user id (not email) because the caller is signed in.
- **Alternatives:** a new `ChangePasswordThrottleService` copying the class.

## D8. Active sessions

- **Decision:** `GET /auth/sessions` → `{ items: [{ id, userAgent, createdAt, lastActiveAt, isCurrent }] }`: the user's sessions with `endedAt = null` and `lastActiveAt` within `SESSION_IDLE_DAYS` (an idle one not yet marked expired is hidden), newest `lastActiveAt` first. No `ipAddress` (Q3). No pagination: a user has a handful of live sessions; deliberate exception to the `limit/cursor` list rule in `nestjs.md`, noted in the controller.
- `DELETE /auth/sessions/:sessionId` → 204, ends one of the user's **other** live sessions (`end_reason = 'signed_out_by_user'`). Unknown id, someone else's session or an already ended one → 404 `SESSION_NOT_FOUND`. The current session → 400 `CURRENT_SESSION` (the frontend uses `POST /auth/logout` for that).
- `DELETE /auth/sessions` → 204, ends every live session of the user except the current one (`signed_out_by_user`). No other sessions → still 204.
- **Note:** `lastActiveAt` is refreshed at most once an hour by `SessionGuard` (`REFRESH_AFTER_MS`), so "last active" is accurate to about an hour.

## D9. Profile read/edit

- **Decision:** `GET /users/me` and `PATCH /users/me` `{ fullName }` both return `{ id, email, fullName, avatarUrl, hasPassword, googleLinked }`. `fullName` trimmed, `@IsNotEmpty` (same as sign-up; DB CHECK `trim(full_name) <> ''`); no max length: BRD `requirements.md` decision #36 says Full name has no maximum, on sign-up and in Profile (security review L1 was closed on that basis). `hasPassword` / `googleLinked` are booleans from `passwordHash` / `googleSubject`; the hash and Google subject are never returned. The email is not editable.

## D10. Deferred after review

- Audit log rows for change password and ending sessions (security review M2): BRD §10 lists admin actions only, and no self-service flow (reset, logout) writes audit rows yet. Moved to Trello card #56 "Decide and implement audit log for self-service account security actions", which asks the project owner first.
