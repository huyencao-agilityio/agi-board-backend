@AGENTS.md

## Claude Code

- Reply to the user in Vietnamese; code, comments, commits and PRs in English.
- Creating a pull request: use the `create-pr` skill.
- `prisma migrate reset` (and `pnpm db:reset`) is blocked by Prisma when run by an AI agent. Do not bypass
  it; ask the user to run it.
- Before saying a change is done, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` when
  the change touches the database, guards or HTTP behavior.
