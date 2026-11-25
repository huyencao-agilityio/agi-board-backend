# Quickstart: validate #52

## Before merge

1. `pnpm exec prettier --check .github/workflows/claude.yml .github/workflows/claude-code-review.yml`: passes.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`: pass.

The review job on this PR can be skipped because its workflow file differs from `develop`.

## After merge

Prerequisite: the `CLAUDE_CODE_OAUTH_TOKEN` secret and the Claude GitHub App, both set up in #47.

| #   | Do                                                                   | Expect                                                                                                               |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Open a PR into `develop` with two deliberate bugs in different files | The review starts by itself; one inline comment per bug on the right line, with severity, impact and fix; no summary |
| 2   | Push another commit without fixing the bugs                          | The same problems are not posted again                                                                               |
| 3   | Push twice within a minute                                           | The first run is cancelled                                                                                           |
| 4   | Comment `@claude review`                                             | New findings are inline; the tracking comment only gives a count                                                     |
| 5   | Open a small clean PR                                                | Nothing is posted; the run completes and its log lists the reviewed files                                            |
| 6   | Open a PR with a diff over 70 KB                                     | The log lists every changed file except lock files                                                                   |

Close the test PRs without merging.
