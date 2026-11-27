# Quickstart: #6 Home — Workspaces, Boards and Invites

## Setup

```bash
pnpm install && pnpm db:migrate && pnpm db:seed   # done by /pull-ticket for this worktree
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

E2E file: `test/home.e2e-spec.ts` (users under `@home.e2e.test`, own cleanup). Sign users in with the
`signedIn()` pattern from `test/app.e2e-spec.ts`; create boards and invites directly with `PrismaService` (no
board/invite create endpoints exist yet, Q1).

## Scenarios (each an e2e case; contracts in [contracts/http.md](./contracts/http.md))

| # | Given | When | Then |
|---|---|---|---|
| 1 | new user | `GET /home` | 200, all four arrays empty (AC 5) |
| 2 | — | `POST /workspaces {name:"  Team  "}` | 201, `name:"Team"`, `role:"admin"`, `memberCount:1`; audit row `workspace_created`; appears in `GET /home` (AC 1.2) |
| 3 | — | `POST /workspaces {name:"   "}` / unknown field / no CSRF | 400 `VALIDATION_FAILED` / 400 / 403 `CSRF_INVALID` |
| 4 | member of W1 (2 boards) and W2 | `GET /home` | each tile has name, `boardCount`, `memberCount` (AC 4.1) |
| 5 | workspace member; W has a `workspace` board and a `private` board not on it | `GET /home` | only the workspace board; as admin, both (AC 4.2) |
| 6 | board-only member of one private board in W | `GET /home` | W listed with `role:null`, `memberCount:null`, only that board |
| 7 | 2 starred + 8 viewed boards (2 of them starred) | `GET /home` | `starred` in star order; `recent` = 6 newest viewed, starred ones included with `starred: true` (AC 2.1, Q4 revised) |
| 8 | starred + viewed board, then board closed / workspace archived / membership removed | `GET /home` | gone from `starred` and `recent` (AC 2.2, Q3) |
| 9 | — | `PUT` star twice, `DELETE` star twice | 204 each; one row then none |
| 10 | board the user cannot see | `PUT …/star`, `POST …/views` | 404 `BOARD_NOT_FOUND` |
| 11 | — | `POST …/views` twice | one `board_views` row, `last_viewed_at` moved forward |
| 12 | pending workspace invite to my email | `GET /home` | invite with workspace name and sender name (AC 3.1) |
| 13 | same | `POST …/accept` | 200; workspace member with invite role; W in `GET /home`; invite gone (AC 3.2) |
| 14 | board-only member of B in W, pending workspace invite + pending board invite to B2 in W | accept workspace invite | still member of B (role kept), now member of B2, both invites accepted |
| 15 | pending invite | `POST …/decline` | 204; gone from Home (AC 3.3) |
| 16 | expired invite | `GET /home` / accept / decline | `expired:true` / 409 `INVITE_EXPIRED` / 204 (AC 3.4) |
| 17 | pending board invite | `GET /home`, accept | shows board + workspace names; 200; board-only member (AC 7.1, 7.2) |
| 18 | invite for another email, or already declined | accept / decline | 404 `INVITE_NOT_FOUND` |
| 19 | pending invite | two accepts with `Promise.all` | one 200, one 404; one membership row |
| 20 | W visible to me / not visible / archived | `GET /workspaces/:id` | 200 tile with accessible boards / 404 / 404 `WORKSPACE_NOT_FOUND` (AC 6.1) |
| 21 | no session | any route | 401 |
| 23 | board with a preset background / without one | `GET /home`, then GET the URL | `backgroundThumbnailUrl` set and the image returns 200 `image/jpeg` / `null` with its `backgroundColor`; unknown key → 404 `BACKGROUND_NOT_FOUND` |
| 22 | admin of archived W1, member of archived W2 / neither | `GET /home` | `hasArchivedWorkspaces:true`, W1/W2 not in `workspaces` / `false` (member of archived W2 only → `false`) |

Unit: rows added to `src/modules/permissions/board-access.spec.ts` only if `canViewBoard` changes (it does not; the
closed/archived conditions live in the filter and are covered by scenario 8).

## Manual check

```bash
pnpm start:dev   # http://localhost:8787/api/v1, Swagger UI at /api/docs, JSON at /api/docs-json
```
Sign in, `POST /workspaces`, then `GET /home`.
