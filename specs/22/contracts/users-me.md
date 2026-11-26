# Contract: profile and avatar (`/api/v1/users/me`)

All routes need a session (401 without one, 401 `SESSION_ENDED` for an ended one). Writes need the CSRF header (403 `CSRF_INVALID`). Errors use `{ error: { code, message, details? } }`.

## Profile shape

```json
{
  "id": "0193...",
  "email": "user@example.com",
  "fullName": "Jane Doe",
  "avatarUrl": "/api/v1/users/me/avatar?v=0193...",
  "hasPassword": true,
  "googleLinked": false
}
```

`avatarUrl` is `null` when there is no photo (the frontend shows initials).

## GET /users/me

200 → profile.

## PATCH /users/me

Body `{ "fullName": "  Jane  " }` (trimmed). 200 → profile with the new name.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `fullName` missing, not a string, empty after trim, or unknown field |

## PUT /users/me/avatar

Body: `multipart/form-data` with one file field `file` (JPEG/JPG, PNG, WebP or GIF, ≤ 5 MB). Frontend: `const fd = new FormData(); fd.append('file', file); fetch(url, { method: 'PUT', body: fd, credentials: 'include', headers: { 'x-csrf-token': token } })` (do not set `Content-Type` by hand; the browser adds the boundary). 200 → profile with the new `avatarUrl`.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Not `multipart/form-data`, unparsable body, or no non-empty `file` field |
| 409 | `AVATAR_CONFLICT` | Another upload or remove changed the avatar at the same time; nothing stored, try again |
| 413 | `PAYLOAD_TOO_LARGE` | File over 5 MB (or the whole body, or its declared `Content-Length`, over 5 MB + 64 KB) |
| 415 | `UNSUPPORTED_IMAGE_TYPE` | Bytes are not JPEG/PNG/WebP/GIF (the part's type and file name are ignored) |

The stored type is the one detected from the bytes. The previous photo is deleted from storage after the update (a failed delete is logged only).

## DELETE /users/me/avatar

204. Idempotent: no photo → 204. The photo is deleted from storage after the update.

## GET /users/me/avatar

200 → image bytes, `Content-Type` as stored, `Cache-Control: private, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: same-site`. The `v` query parameter is ignored (cache buster).

| Status | Code | When |
|---|---|---|
| 404 | `AVATAR_NOT_FOUND` | No photo (or the object is missing in storage) |
