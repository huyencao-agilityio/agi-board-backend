# Implementation Plan: #54 Implement feature user logout (backend)

**Branch**: `feat/54-implement-feature-user-logout` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/54/spec.md`

## Summary

Add `POST /auth/logout`. It ends the session behind the request's session cookie (`endedAt = now`, `endReason = 'logout'`), clears the session and CSRF cookies, and answers 204. Calling it again on that same session also answers 204. The route is `@Public()` (CSRF still applies) and checks the cookie itself: `SessionGuard` rejects ended sessions, so the "already ended → 204" rule cannot hold behind it (decision D1, chosen by the user on 2026-11-26). No cookie or an unknown token still answers 401. There is no schema change; the existing `SessionGuard` already answers a plain 401 for a session ended by logout.

This repo does only the card's **Backend** scope. Frontend items (user menu, clearing the cache, redirect) belong to the frontend repo.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 tooling, NestJS 11, Prisma 7.10 (D1 adapter)

**Primary Dependencies**: existing only (`cookie-parser`, Express `res.clearCookie`)

**Storage**: Cloudflare D1 `user_sessions` (`ended_at`, `end_reason` enum already has `logout`); no schema or migration change

**Testing**: Jest unit (`src/modules/auth/session/session.service.spec.ts`) and e2e against local D1 (`test/session.e2e-spec.ts`)

**Target Platform**: Cloudflare Workers

**Project Type**: web-service (REST API)

**Performance Goals**: one D1 write for a live session; one write plus one read when the session is already ended or unknown

**Constraints**: CSRF stays on; cookies are cleared with the same `path`/`sameSite`/`secure` they were set with, otherwise browsers keep them; never end any session other than the cookie's own; no new error codes

**Scale/Scope**: 1 route, 1 service method, 1 cookie helper, ~5 unit and ~8 e2e cases, 1 line in `security.md`

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template and defines no gates. Checked against `AGENTS.md` and `.claude/rules/*`:

| Rule | Status |
|------|--------|
| `@Public()` only for routes a signed-out user must reach | **Exception, approved by the user (D1)**: logout must answer 204 for an already-ended session. The service still requires a known session cookie (401 otherwise). One line added to `security.md` so the rule and the code agree |
| CSRF on every write, public routes included | Pass: `CsrfGuard` is global and untouched |
| Logout is `POST` only and sets `endedAt` (`security.md`) | Pass |
| Session cookie options `httpOnly`, `lax`, `secure` in prod, `path: '/'` | Pass: clearing reuses the same options (D3) |
| Thin controller, Prisma in the service | Pass: controller calls `SessionService.logout` |
| Status codes: action `POST` uses 200 or 204 (`nestjs.md`) | Pass: 204, as the card says |
| Errors through Nest exceptions and the global filter | Pass: plain `UnauthorizedException`, same body as `SessionGuard`'s |
| Log ids, not tokens/cookies | Pass: nothing new is logged |
| New endpoint needs e2e: happy path, 401, CSRF 403 for `@Public` writes (`testing.md`) | Planned in quickstart; no 400 case because the route has no body/DTO, no 404 because there is no resource id |
| No new dependency, no schema change | Pass |

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/54/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── auth-logout.md
└── tasks.md              # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/common/
└── session-cookie.ts               # + clearAuthCookies(res, config): session + CSRF cookie, same options as set
src/modules/auth/
├── auth.controller.ts              # + @Public() @Post('logout') @HttpCode(204), why-comment
└── session/
    ├── session.service.ts          # + logout(req, res)
    └── session.service.spec.ts     # + logout cases
test/
└── session.e2e-spec.ts             # + POST /auth/logout cases (real sign-in for the happy path)
.claude/rules/
└── security.md                     # + logout as the one @Public route that needs a session cookie
```

**Structure Decision**: Logout ends a session, so it lives in the existing `SessionService` next to `createSession`. No new module, folder or DTO.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `@Public()` on a route that needs a session | Card AC: already-ended session → 204 | Keeping `SessionGuard` answers 401 for an ended session and fails that AC; "always 204" drops the card's "requires a valid session" (see research D1) |
