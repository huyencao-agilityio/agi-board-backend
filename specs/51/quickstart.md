# Quickstart: #51 Refactor auth module structure

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm build
pnpm test          # baseline 69 tests, plus the new specs
pnpm test:e2e      # baseline 105 tests, same count after
pnpm db:check
```

All exit 0.

## Structure checks

| Check | Expect |
|-------|--------|
| `git diff -M origin/develop -- test` | only import lines |
| `git diff origin/develop --stat -- prisma package.json pnpm-lock.yaml` | empty |
| `grep -rnw AuthService src test` | no match |
| `grep -rn "code: 'ACCOUNT_DEACTIVATED'" src --exclude='*.spec.ts'` | one match |
| `grep -rn "email.toLowerCase()" src/modules/auth --include='*.service.ts'` | no match (only in `throttle-key.ts`) |
| `grep -rnE "prisma\|forwardRef" src/modules/auth --include='*.controller.ts'` | no match |

## Manual check

Run the scenarios of `specs/4/quickstart.md` and `specs/5/quickstart.md`; same results as before. For Google, at least: not configured, declined consent (`/sign-in`), forged `state` (`?error=google_failed`).
