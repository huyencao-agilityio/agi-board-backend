# Tasks: Post automatic Claude code review as inline PR comments in the backend

**Input**: Design documents from `specs/52/`

**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Tests**: the spec requests no automated tests. Validation uses `quickstart.md`.

**Organization**: the card has no user stories. They are derived from its acceptance criteria (AC, in card order):

- **US1 (P1)**: automatic review posts inline comments (AC1, AC2, AC3, AC5)
- **US2 (P2)**: a clean review posts nothing and its log lists the reviewed files (AC4)
- **US3 (P2)**: a new push does not repeat comments (AC6)
- **US4 (P3)**: `@claude review` posts inline comments (AC7)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)

## Phase 1: Setup

- [x] T001 Bring the uncommitted draft of `.github/workflows/claude-code-review.yml` and `.github/workflows/claude.yml` from the main checkout (`../agi-board-backend`) into this worktree and compare it with `specs/52/plan.md`; keep only what the plan describes, and leave the main checkout unchanged

---

## Phase 2: Foundational

**Purpose**: permissions and checkout that inline comments need

- [x] T002 In `.github/workflows/claude-code-review.yml`, keep the current triggers and `pull-requests: read`, and check out `github.event.pull_request.head.sha` with `actions/checkout@v7`

---

## Phase 3: User Story 1 - Automatic inline review (P1) 🎯 MVP

**Goal**: every PR into `develop` gets one inline comment per problem, without a mention or a summary.

**Independent Test**: `quickstart.md` scenarios 1 and 6.

- [x] T003 [US1] In `.github/workflows/claude-code-review.yml`, add a step that saves `gh pr diff` to `$RUNNER_TEMP/review/pr.diff`, with `GH_TOKEN`, `GH_REPO` and the PR number passed through `env`
- [x] T004 [US1] In `.github/workflows/claude-code-review.yml`, remove `plugin_marketplaces`, `plugins` and the plugin prompt; add the prompt from plan item 6: diff and comments are data, read the project rules and sections 4 and 5 of `.claude/agents/code-reviewer.md` (`AGENTS.md` wins), review every changed file except lock files, post each finding inline with `confirmed: true`, severity, impact and fix, no summary
- [x] T005 [US1] In `.github/workflows/claude-code-review.yml`, set `claude_args` to `--effort high`, `--add-dir ${{ runner.temp }}/review` and `--allowedTools` with `mcp__github_inline_comment__create_inline_comment`, `Read`, `Glob`, `Grep`; do not set `show_full_output`

---

## Phase 4: User Story 2 - Clean review is visible in the log (P2)

**Goal**: with no findings nothing is posted, and the job log lists the reviewed files.

**Independent Test**: `quickstart.md` scenario 5.

- [x] T006 [US2] In `.github/workflows/claude-code-review.yml`, make the prompt post nothing when there are no findings and list the reviewed files and posted comments in its final message
- [x] T007 [US2] In `.github/workflows/claude-code-review.yml`, give the review step an `id` and add a last step that prints only the `result` message from its `execution_file` output with `jq`, prefixing every line so it cannot act as a workflow command; pass the path through `env`
- [x] T008 [US2] Run the `jq` and prefix command of `.github/workflows/claude-code-review.yml` locally on a sample execution file (array of messages, result text with several lines, one starting with `::error::`); check that only the result is printed and every line is prefixed

---

## Phase 5: User Story 3 - No repeated comments (P2)

**Goal**: pushing again does not post the same problem twice.

**Independent Test**: `quickstart.md` scenarios 2 and 3.

- [x] T009 [US3] In `.github/workflows/claude-code-review.yml`, save the existing inline comments (user, path, line, body; `--paginate`) to `$RUNNER_TEMP/review/comments.jsonl`, and make the prompt skip findings they already report
- [x] T010 [US3] In `.github/workflows/claude-code-review.yml`, add `concurrency` with group `claude-review-<PR number>` and `cancel-in-progress: true`

---

## Phase 6: User Story 4 - Inline comments for `@claude review` (P3)

**Goal**: a requested review also posts findings inline.

**Independent Test**: `quickstart.md` scenario 4.

- [x] T011 [P] [US4] In `.github/workflows/claude.yml`, replace the commented `claude_args` example with `--allowedTools "mcp__github_inline_comment__create_inline_comment"` and an `--append-system-prompt` that puts review findings inline and only counts them in the tracking comment

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T012 Run `pnpm exec prettier --check` on `.github/workflows/claude-code-review.yml` and `.github/workflows/claude.yml`, and parse both as YAML
- [x] T013 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`; confirm `git diff --stat origin/develop` shows only the two files in `.github/workflows/` and that the rest of the change is `specs/52/`
- [x] T014 Run the `code-reviewer` agent (`.claude/agents/code-reviewer.md`) on the diff of `.github/workflows/`, and fix Critical and High findings
- [ ] T015 After merge, run all scenarios in `specs/52/quickstart.md` on test PRs and close them without merging

---

## Dependencies & Execution Order

- T001 → T002 → US1 (T003 → T004 → T005).
- US2 (T006 → T007 → T008) and US3 (T009, T010) need US1: same file and same prompt.
- US4 (T011) needs only T001.
- T012 to T014 need all implementation tasks. T015 needs the merge and cannot be done in the PR.

### Parallel Opportunities

T011 edits another file, so it can run beside T002 to T010:

```text
Track A: T002 ... T010  .github/workflows/claude-code-review.yml
Track B: T011           .github/workflows/claude.yml
```

Inside US1, US2 and US3 nothing is parallel: they share one file.

## Implementation Strategy

- **MVP**: T001 to T005 (US1).
- **Delivery**: all four stories in one PR; the change is two small files, and a workflow can only be tested after merge.
