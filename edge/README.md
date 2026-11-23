# edge

The Cloudflare Worker entry. The whole NestJS API runs inside one Worker (no container); config is
`wrangler.jsonc` at the repo root.

| File               | Role                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `src/index.mjs`    | Hands the bindings (`DB` = D1, `IMAGES` = R2) to `src/cloudflare.ts`, builds the Nest app and serves it through `httpServerHandler` (Express on the Workers `node:http` server). |
| `src/empty-module.mjs` | Stand-in for optional Nest packages the app never loads (`alias` in `wrangler.jsonc`).                       |

## Build

`wrangler dev` / `wrangler deploy` run `nest build` first (`build.command` in `wrangler.jsonc`), then bundle
`dist/` from `src/index.mjs`. Nest is compiled by `tsc` because esbuild, which wrangler bundles with, cannot
emit the decorator metadata Nest's dependency injection reads.

## Request flow

```
Browser ──HTTPS /api/v1/*──▶ Worker (Nest + Express) ──▶ D1 (DB) / R2 (IMAGES)
```

## Not built yet

Real-time board updates (Durable Object per board, WebSocket Hibernation API) and the due-date reminder
Cron Trigger. Both would be added to this Worker (`durable_objects`, `triggers.crons` in `wrangler.jsonc`)
when their tickets come up.
