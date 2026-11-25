# Research: #51 Refactor auth module structure

No open NEEDS CLARIFICATION. Choices the card leaves open:

## R1 Split without a facade

- **Decision**: delete `AuthService`; controllers inject the flow services.
- **Rationale**: the card says it is replaced; a facade would only forward calls.
- **Alternatives considered**: keep `AuthService` as a facade (rejected: an extra layer with no logic).

## R2 Google callback

- **Decision**: `GoogleSignInService.handleCallback` takes code, state, error and the cookie value, and returns a frontend path. The controller handles cookies and the redirect.
- **Rationale**: mapping failures to destinations is a rule; cookies and redirects are HTTP work.
- **Alternatives considered**: an exception filter (rejected: changes the error path and spreads the flow over two files).

## R3 Where `sendCode` lives

- **Decision**: `EmailVerificationService.sendCode(user)`: issue the code, then email it. Its constructor gains `EmailService`, so its unit spec passes a second argument.
- **Rationale**: sign-in and sign-up both need it; it keeps them independent of each other.
- **Alternatives considered**: `SignInService` depending on `SignUpService` (rejected: couples two flows); copying it (rejected: duplication).
- **E2e**: the sign-up tests spy on `claim` and `consume` of the instance from `app.get(EmailVerificationService)`; both stay methods of that class.

## R4 Shared selects

- **Decision**: in `auth-user.select.ts`, `signedInUserSelect` (id, email, fullName, systemRole, emailVerifiedAt; used by `me`) and `passwordUserSelect` (plus deactivatedAt and passwordHash; sign-in and verify-email). Google spreads the base and adds deactivatedAt and googleSubject. The select used by resend and `signUpAgain` is a constant in `sign-up.service.ts`.
- **Rationale**: the same columns are read as today, and `passwordHash` is never loaded where it was not.
- **Alternatives considered**: one large select (rejected: `me` and Google would load the hash).

## R5 Shared errors, key and conflict check

- **Decision**: `accountDeactivated()` in `auth-errors.ts`; `throttleKey(scope, email)` in `throttle-key.ts`; `isUniqueConflict` in `src/database/prisma-errors.ts`. Errors used in one file stay there. The code hash and the session-token hash keep their own functions: they hash different things.
- **Rationale**: extract only what is duplicated across files.
- **Alternatives considered**: a catalogue of all auth errors (rejected: nothing else is duplicated across files). Using `isUniqueConflict` in `AllExceptionsFilter` (rejected: outside the card).

## R6 Module exports

- **Decision**: remove `exports` (`PasswordService`, `SignInThrottleService`).
- **Rationale**: no file in `src/` outside `modules/auth` imports them. E2e `app.get(...)` is not strict, so it still resolves them.

## R7 Unit specs

- **Decision**: one spec per new service with small fakes, constructed directly as the existing auth specs do. Assert order and guards: attempt before verify, dummy verification, conditional-update conflicts, link guard, callback paths. Include error branches; leave real database behavior to e2e.
- **Alternatives considered**: repeating the e2e scenarios (rejected: slow to maintain, no new signal).
