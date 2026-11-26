# Quickstart: validate #22 Profile and Account Settings

Contracts: [contracts/users-me.md](./contracts/users-me.md), [contracts/auth-account.md](./contracts/auth-account.md). Decisions: [research.md](./research.md).

## Prerequisites

Worktree `agi-board-backend-22`, `pnpm install`, `pnpm db:migrate && pnpm db:seed` (local D1 + R2).

## Automated checks

```bash
pnpm lint && pnpm typecheck
pnpm test        # unit
pnpm test:e2e    # touches DB, guards and HTTP: required
pnpm db:check    # must stay clean: no schema change
```

Expected e2e coverage (`test/profile.e2e-spec.ts`, `test/account-security.e2e-spec.ts`), each route with happy path, 401 without session, 403 without CSRF on writes, and its 400/404/413/415/429 cases:

| Scenario | Expected |
|---|---|
| `GET /users/me` signed in (password account) | 200, `hasPassword: true`, `googleLinked: false`, `avatarUrl: null` |
| `PATCH /users/me` `{ fullName: "  New  " }` | 200, `fullName: "New"`; `GET /auth/me` shows the new name |
| `PATCH /users/me` `{ fullName: "   " }` | 400 `VALIDATION_FAILED` |
| `PUT /users/me/avatar` multipart, field `file` = small PNG (supertest `.attach('file', buf, 'a.png')`) | 200, `avatarUrl` set; object exists in local R2; `GET` that URL → 200 `image/png`, same bytes, `Cross-Origin-Resource-Policy: same-site` |
| Upload a second image | new `avatarUrl`; the first R2 object no longer exists |
| PNG bytes in a part typed `image/jpeg` named `a.jpg` | 200, stored as `image/png` |
| Text bytes in a part typed `image/png` | 415 `UNSUPPORTED_IMAGE_TYPE`, avatar unchanged |
| Multipart without a `file` field / JSON body | 400 `VALIDATION_FAILED` |
| File of 5 MB + 1 byte | 413 `PAYLOAD_TOO_LARGE` (not 500), avatar unchanged |
| JSON body over 100 kB on any route | 413 (filter fix, was 500) |
| `DELETE /users/me/avatar` | 204, `avatarUrl: null`, object gone, `GET /users/me/avatar` → 404 |
| Change password, right current + valid new | 204; other session → 401 `SESSION_ENDED`; current session still 200; sign-in with new password works |
| Wrong current password | 400 `CURRENT_PASSWORD_INCORRECT`, hash unchanged, no session ended |
| 6th try after 5 wrong | 429 `CHANGE_PASSWORD_LOCKED`; sign-in with the old password still works |
| Weak new password | 400 `VALIDATION_FAILED` with rule messages |
| Google-only account | 400 `PASSWORD_NOT_SET` |
| `GET /auth/sessions` with 2 sessions | 2 items, exactly one `isCurrent`, no `ipAddress`; ended and idle-expired sessions absent |
| `DELETE /auth/sessions/:otherId` | 204; that session → 401 `SESSION_ENDED` |
| Same with own id / another user's id | 400 `CURRENT_SESSION` / 404 `SESSION_NOT_FOUND` |
| `DELETE /auth/sessions` | 204; all others ended, current still works |

## Manual check (optional)

`pnpm start:dev`, sign in through the API, then:

```bash
curl -b jar -c jar -X PUT http://localhost:8787/api/v1/users/me/avatar \
  -H "x-csrf-token: <token from cookie>" -F "file=@assets/backgrounds/thumbs/lake.jpg"
```

Local R2 only (`.wrangler/`); no remote bucket.

Open the returned `avatarUrl` in the same browser session; the image shows.
