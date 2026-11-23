@AGENTS.md

## Claude Code

- Reply to the user in Vietnamese; code, comments, commits and PRs in English.
- Starting work on a Trello card (number or URL): use the `pull-ticket` skill.
- Creating a pull request: use the `create-pr` skill.
- The full flow is the diagram in `README.md`: after implementing, run the checks, then the `code-reviewer` agent
  (and `security-auditor` when the change touches auth, guards, controllers, DTOs, Prisma queries or config), fix
  Critical and High findings, and only then `/create-pr`. Do not rely on a skill's "Next" line alone for this.
- `pnpm db:reset` deletes the local D1 (`.wrangler/state/v3/d1`), then re-migrates and seeds it. The guard hook
  blocks it for agents because it wipes local data; do not bypass it, ask the user to run it.
- Before saying a change is done, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` when
  the change touches the database, guards or HTTP behavior.
- Path-scoped rules in `.claude/rules/` (code style, NestJS/API, security, database, testing) load when matching
  files are touched; keep them in sync with the code when a convention changes.
- Hooks in `.claude/hooks/guard.mjs` (wired in `.claude/settings.json`) block unsafe git/file/database/Cloudflare commands (deploys and remote D1/R2 run only from CI),
  run Prettier after edits and stop a turn until the checks above pass. A `[guard]` denial is intentional: ask
  the user instead of working around it. After changing the hook, run `node --test .claude/hooks/guard.test.mjs`.
