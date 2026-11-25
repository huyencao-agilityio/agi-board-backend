# Implementation Plan: Post automatic Claude code review as inline PR comments in the backend

**Branch**: `fix/52-inline-claude-review-comments` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/52/spec.md`

## Summary

The automatic review runs but posts one summary and no inline comments. Replace the `code-review` plugin in
`claude-code-review.yml` with an explicit prompt that reviews the whole diff and posts each finding through
`mcp__github_inline_comment__create_inline_comment`. Allow the same tool in `claude.yml` for `@claude review`.
Decisions and evidence: [research.md](research.md).

## Technical Context

**Language/Version**: GitHub Actions YAML; the prompt is English text

**Primary Dependencies**: `anthropics/claude-code-action@v1`, `actions/checkout@v7`, `gh` (preinstalled on the runner)

**Storage**: N/A (two temporary files in `$RUNNER_TEMP/review`)

**Testing**: YAML parse and Prettier locally; local dry run of the prompt; a real PR after merge ([quickstart.md](quickstart.md))

**Target Platform**: GitHub-hosted `ubuntu-latest`

**Project Type**: CI workflow of a web service

**Performance Goals**: none in the spec; dry runs took about 80 seconds and 0.40 USD at list price

**Constraints**: `claude-code-action` can skip a PR whose workflow file differs from `develop`, so the real test is
after merge. The PR diff and comments are untrusted input.

**Scale/Scope**: 2 workflow files; PRs of about 30 files and 100 KB of diff

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so it defines no gates. Checked against `AGENTS.md`:

| Rule                                                  | Before design | After design                                                        |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| Scope: only what the card asks                        | Pass          | Pass: two workflow files; frontend and `code-reviewer.md` untouched |
| No secrets in code or logs                            | Pass          | Pass: token stays in `secrets`; `show_full_output` is not enabled   |
| Git: branch, commit and PR conventions; no auto-merge | Pass          | Pass: the workflow never approves or merges                         |
| Checks pass before done                               | Pass          | Pending implementation: `pnpm lint`, `pnpm typecheck`, `pnpm test`  |

## Design

### `claude-code-review.yml`

1. Trigger unchanged: `opened`, `synchronize`, `ready_for_review`, `reopened` on PRs into `develop`.
2. `concurrency` per PR number with `cancel-in-progress: true`.
3. `pull-requests: read`: comments are posted with the Claude App token.
4. Check out `github.event.pull_request.head.sha`.
5. New step: save `gh pr diff` and the inline comments of Claude and the team to `$RUNNER_TEMP/review`.
6. Prompt: read the project rules and sections 4 and 5 of `code-reviewer.md` (`AGENTS.md` wins); review every changed
   file except lock files; report Critical to Medium, and Low with a real consequence; one inline comment per finding
   with `confirmed: true`; skip findings already reported; no summary; list the reviewed files in the job log.
7. `claude_args`: `--effort high`, `--add-dir` for the saved files, `--permission-mode default` and `--tools` so
   Bash and Write are unavailable.
8. New last step: print only Claude's final message from the action's `execution_file` output, each line prefixed so it
   cannot act as a workflow command. The action hides it otherwise.

### `claude.yml`

1. Allow the inline comment tool and append a system prompt: findings go inline, the tracking comment only counts them.

### Acceptance criteria coverage

| Criterion                                               | Covered by              |
| ------------------------------------------------------- | ----------------------- |
| Starts without `@claude`                                | Review workflow 1       |
| Problem is an inline comment with severity, impact, fix | Review workflow 4, 6    |
| One comment per problem, no summary                     | Review workflow 6       |
| No problem: nothing posted, log lists files             | Review workflow 6, 8    |
| Large diff fully reviewed                               | Review workflow 5, 6    |
| No repeated comment after a push                        | Review workflow 2, 5, 6 |
| `@claude review` posts inline                           | `claude.yml` 1          |

All except the first depend on the model following the prompt, so they need the post-merge check.

## Project Structure

### Documentation (this feature)

```text
specs/52/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
└── tasks.md        # created by /speckit-tasks
```

No `data-model.md` (no entities) and no `contracts/` (no API change; internal CI only).

### Source Code (repository root)

```text
.github/workflows/
├── claude-code-review.yml   # changed
└── claude.yml               # changed
```

**Structure Decision**: edit the two existing workflows; no new workflow, script or dependency.

## Complexity Tracking

No violations.
