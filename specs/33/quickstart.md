# Quickstart: #33 Create Workspace

## Prerequisites

Worktree set up (`pnpm install`, `pnpm db:migrate`, `pnpm db:seed`).

## Automated check

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected: `test/home.e2e-spec.ts` › "US1 create workspace" passes, including the new cases:

| Scenario | Expected |
|---|---|
| `{ "name": "Team\nAlpha" }` | 201, `name: "Team Alpha"` |
| `{ "name": "\n\n" }` | 400 `VALIDATION_FAILED` |
| Same name posted twice | both 201, different `id`, both listed on `GET /home` |
| Existing cases (trim, 100/101 chars, admin + audit row, CSRF) | unchanged |

## Manual check (optional)

`pnpm start:dev`, sign in, then with the session and CSRF cookies plus the `X-CSRF-Token` header:
`POST http://localhost:8787/api/v1/workspaces` with the bodies above, then `GET /api/v1/workspaces/<id>` →
200 with `role: "admin"`, `boardCount: 0`, `memberCount: 1`. See [contracts/workspaces.md](contracts/workspaces.md).
