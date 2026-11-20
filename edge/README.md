# edge (not implemented yet)

Cloudflare code that fronts the API. Only the folder exists for now; it is implemented in the
deployment phase. Nothing here is built, linted or deployed by CI yet.

## Planned contents

| File                   | Role                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`         | Gateway Worker. `fetch`: `/api/*` → `ApiContainer`, `/ws/boards/:id` → `BoardRoom`, `/internal/broadcast` from the API. `scheduled`: Cron Trigger → API reminders endpoint. Blocks outside access to `/internal/*`. |
| `src/api-container.ts` | `class ApiContainer extends Container` (`@cloudflare/containers`), runs this repo's `Dockerfile`.                                                                                                                   |
| `src/board-room.ts`    | Durable Object, one per board. Holds viewers' WebSockets (Hibernation API) and pushes changes the API sends after each commit.                                                                                      |
| `wrangler.jsonc`       | Bindings: `containers`, `durable_objects`, `triggers.crons`; envs `staging`, `production`.                                                                                                                          |
| `package.json`         | Own dependencies (`wrangler`, `@cloudflare/containers`); added to `pnpm-workspace.yaml` and CI when implemented.                                                                                                    |

## Request flow

```
Browser ──HTTPS /api/*──▶ Gateway Worker ──▶ ApiContainer (NestJS) ──▶ PostgreSQL / R2 / email
Browser ◀─WSS /ws/boards/:id─▶ Gateway Worker ──▶ BoardRoom (Durable Object)
ApiContainer ──POST /internal/broadcast (HMAC)──▶ Gateway Worker ──▶ BoardRoom
Cron Trigger ──▶ Gateway Worker ──POST /internal/cron/reminders (HMAC)──▶ ApiContainer
```

## To verify first (risk R-07)

1. Worker forwards requests to the container with cookies and headers intact.
2. The container can call back into the Worker to broadcast (signed with a shared HMAC secret).
3. Before a WebSocket upgrade, the Worker asks the API whether the cookie's user may view the board.
4. Container cold start and idle sleep times; choose `sleepAfter` and minimum instances.
5. Cron Trigger reaches the reminders endpoint.
