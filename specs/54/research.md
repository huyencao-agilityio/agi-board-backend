# Research: #54 User logout (backend)

No open NEEDS CLARIFICATION remains. The decisions below come from the card, the existing code (`SessionGuard`, `CsrfGuard`, `session-cookie.ts`) and `.claude/rules/`.

## D1: Route auth: `@Public()` plus the service's own cookie check

- **Decision**: Mark `POST /auth/logout` `@Public()`. `SessionService.logout` reads the session cookie:
  - no cookie → 401;
  - a token that matches no session → 401;
  - a session that is still live → end it with `endReason = 'logout'`, clear the cookies, 204;
  - a session that has already ended (for any reason) → leave its row unchanged, clear the cookies, 204.
- **Rationale**: The card asks for two things that clash behind the guard. "Requires a valid session (`SessionGuard`)" conflicts with "already-ended session → 204", because `SessionGuard` throws 401 for any ended session. This option keeps both meanings: a request still has to present a real session cookie, and a repeat call is idempotent. The user chose it on 2026-11-26. `security.md` asks for approval before an exception to the `@Public()` rule, and that approval was given; the rule gets one line naming logout.
- **Alternatives considered**:
  - Keep `SessionGuard`: fails AC "already-ended session → 204".
  - `@Public()` and always 204, even with no cookie: drops "requires a valid session".
  - Catch the guard's 401 in the controller: guards run before handlers, so this is not possible without a new guard.

## D2: Ending the session

- **Decision**: `updateMany({ where: { tokenHash, endedAt: null }, data: { endedAt: now, endReason: 'logout' } })`. If `count === 0`, run a `findUnique({ where: { tokenHash }, select: { id: true } })` to tell "already ended" (204) from "unknown token" (401).
- **Rationale**: One write in the common case. The `endedAt: null` condition means a session already ended by something else (password reset, admin, expiry) keeps its first `endReason`, so its history stays correct. Matching by the cookie's own `tokenHash` ends only this session, so other devices stay signed in (card rule).
- **Alternatives considered**: read first, then update. That costs two queries every time, and a concurrent end between the read and the write could be overwritten.
- **Edge cases**:
  - Deactivated user, or a session idle past `SESSION_IDLE_DAYS` but not yet marked: the session is ended as `logout` and the answer is 204. Ending it is harmless and it is the user's own session.
  - Concurrent double logout: one `updateMany` wins, the other sees `count = 0`, finds the row, and answers 204.

## D3: Clearing cookies

- **Decision**: Add `clearAuthCookies(res, config)` to `src/common/session-cookie.ts`. It calls `res.clearCookie` for the session cookie (`SESSION_COOKIE_NAME`, `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`) and for `CSRF_COOKIE` (`sameSite: 'lax'`, `secure` in production, `path: '/'`). Both 204 cases use it; the 401 cases do not.
- **Rationale**: Browsers delete a cookie only when the clearing `Set-Cookie` has the same name, path and domain, so the options mirror `setSessionCookie` and `CsrfGuard`. The next safe request issues a new CSRF cookie through `CsrfGuard`, so the user can sign in again right away.
- **Note**: `CsrfGuard` decides `secure` from `process.env.NODE_ENV`, while `setSessionCookie` uses `config.get('NODE_ENV')`. The helper uses the config value for both cookies. They read the same variable, so the result is the same.
- **Alternatives considered**: leave the CSRF cookie in place. Rejected because the card's scope says to clear both.

## D4: Response and errors

- **Decision**: 204 with no body. 401 is a plain `UnauthorizedException()`, the same body `SessionGuard` gives for no or unknown cookie (`UNAUTHORIZED`), with no new code. A missing or wrong CSRF token gets 403 `CSRF_INVALID` from the global guard, before the handler runs.
- **Rationale**: Clients already handle these. 204 matches the card and `nestjs.md` ("POST actions that create nothing use 200 or 204").

## D5: After logout

- **Decision**: No change. `SessionGuard` already answers a plain 401 (not `SESSION_ENDED`) for `endReason = 'logout'`, and `test/session.e2e-spec.ts` already covers that path with a seeded row. The new e2e test covers it through the real endpoint.

## D6: Tests

- **Unit** (`session.service.spec.ts`, Prisma mocked like the existing cases): live session → `updateMany` with `endReason: 'logout'` and cookies cleared; already ended → no second write, cookies cleared; unknown token → 401, no cookies cleared; no cookie → 401 and no query.
- **E2E**: see [quickstart.md](./quickstart.md). It uses the real `POST /auth/sign-in` for the happy path (testing.md: auth endpoints use the real sign-in) and seeded sessions for the ended and other-device cases.
