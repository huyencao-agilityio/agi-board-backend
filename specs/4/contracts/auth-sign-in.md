# Contract: Auth sign-in

Base path `/api/v1`. Error body is the global envelope `{ error: { code, message, details } }`; clients branch on `code`. Messages below are copied from the card, except those marked (proposed) there.

## POST /auth/sign-in

`@Public()`. Needs `csrf_token` cookie + `X-CSRF-Token` header.

Request:

```json
{ "email": "user@example.com", "password": "..." }
```

| Case | Status | Body / `error.code` | Notes |
|------|--------|---------------------|-------|
| Valid, verified, active | 200 | `{ "user": { "id", "email", "fullName", "systemRole" }, "next": "home" }` | Sets session cookie. Frontend goes to `/home` (WEB-03) |
| Valid, email not verified | 200 | same, `"next": "verify-email"` | Changed by #5: no session cookie, a code is emailed; see `specs/5/contracts/auth-sign-up.md`. Frontend goes to `/verify-email` (WEB-16), no error |
| Unknown email, wrong password, or Google-only account | 401 | `INVALID_CREDENTIALS`, "Email or password is incorrect." | Identical for all three |
| Correct credentials, deactivated | 403 | `ACCOUNT_DEACTIVATED`, "This account has been deactivated. Contact your administrator." | With a wrong password the 401 above is returned instead |
| Locked (5 failures, 15 min) | 429 | `SIGN_IN_LOCKED`, "Too many attempts. Try again in 15 minutes." (proposed) | Attempt not counted; same for unknown emails |
| Bad body (invalid email, missing field) | 400 | `VALIDATION_FAILED` | Frontend normally prevents this |
| Missing CSRF | 403 | `CSRF_INVALID` | |

Session cookie: name from `SESSION_COOKIE_NAME`, `httpOnly`, `sameSite: lax`, `secure` in production, `path: /`.

## GET /auth/me

Needs a session (not `@Public()`). Returns `200` with the same body as a successful sign-in: `{ "user": { "id", "email", "fullName", "systemRole" }, "next": "home" | "verify-email" }`. Without a session `401`, or `401 SESSION_ENDED` (see "Any protected route"). The frontend calls it on load, and after the Google redirect lands on `/home` or `/verify-email`, to learn who is signed in. It was not on card #4; added at the project owner's request because the frontend needs it.

## GET /auth/google

`@Public()`. Sets a short-lived httpOnly state cookie and answers 302 to Google's consent page. The frontend loads this URL for `Continue with Google`.

## GET /auth/google/callback

`@Public()`. Always answers 302 to the frontend (`APP_ORIGIN` + path):

| Outcome | Redirect | Cookie |
|---------|----------|--------|
| Success | `/home` (WEB-03), or `/verify-email` (WEB-16) if the user is still unverified, which Google sign-in normally is not | session cookie set |
| User closed the window or declined (`error=access_denied`) | `/sign-in`, no parameter | none |
| Any other Google or validation failure (bad `state`, bad id_token, exchange failed) | `/sign-in?error=google_failed` | none |
| Account deactivated (not on the card; decided in plan Q3) | `/sign-in?error=account_deactivated` | none |

The state cookie is cleared in every case.

## Any protected route

401 `SESSION_ENDED` when the session was ended by an admin, a password change or reset, by the user signing out a device, or by idle expiry (7 days without activity); not by logout. The frontend signs the user out locally, shows the sign-in form, and shows "You were signed out. Sign in again." (proposed). Other 401s keep the default code.

## Env (new)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret), `GOOGLE_REDIRECT_URI` (the callback URL registered in Google Cloud); optional outside production, required in production, `SESSION_IDLE_DAYS` (default 7). The client supplies the Google OAuth project (confirmation C-15).
