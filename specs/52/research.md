# Research: #52 Inline Claude review comments

## Why no inline comments today

- The workflow runs and succeeds; PRs #15 to #18 each received the plugin's "No issues found" comment.
- The logged PR #18 run took 5 turns and about 25 seconds, with 0 permission denials.
- Posting inline works: frontend PR #12 has 3 comments by `claude[bot]`. All 3 report the same problem.
- In the frontend PR #14 run, the 70 KB diff was cut to a 2 KB preview, and Claude reported files it had not read.

## Decision 1: an explicit prompt instead of the plugin

- **Rationale**: the plugin posts a summary when it finds nothing, and its review rules are not ours.
- **Alternatives considered**: keep the plugin and change its tools (the summary stays); a custom script that turns JSON
  findings into a review through the GitHub API (more code to own).

## Decision 2: the inline comment MCP tool with `confirmed: true`

- **Rationale**: it ships with the action, posts on an exact line, and cannot approve a PR. Without `confirmed`, calls
  are buffered and classified after the session.
- **Alternatives considered**: `gh api` review calls from Bash (broader permissions).

## Decision 3: save the diff and existing comments to files

- **Rationale**: the model can read a file in ranges; large command output is truncated. Existing comments let it skip
  duplicates.
- **Alternatives considered**: `git diff origin/develop...HEAD` (the action fetches the base with depth 1, which can
  break the merge base).

## Decision 4: check out the PR head

- **Rationale**: the default is the merge commit, whose line numbers can differ from the diff GitHub shows.
- **Alternatives considered**: keep the merge commit (comments could land on wrong lines).

## Decision 5: inline comments for `@claude review`

- **Rationale**: the action starts the inline comment server in tag mode when the tool is in `--allowedTools`, and merges
  that flag with its own. The tracking comment cannot be turned off there, so it only counts the comments.

## Decision 6: default model, high effort

- **Rationale**: dry runs with Sonnet 5.5 on PR #18 read all changed files (23 turns). With 3 seeded bugs it found all 3
  on the right lines with no false positives.
- **Alternatives considered**: a larger model (more quota; not shown to be needed).

## Decision 7: print the final message in its own step

- **Rationale**: without `show_full_output` the action logs only turn counts and cost, so the job log would not list the
  reviewed files. The final message is in the `execution_file` output. Lines are prefixed because the text is
  influenced by untrusted PR content.
- **Alternatives considered**: `show_full_output: true` (logs every tool result, may expose secrets); `display_report:
true` (renders Claude's output in the step summary; the action advises it only for trusted input).

## Decision 8: restrict tools and comment authors (from code review)

- **Rationale**: the repo is public and the action defaults to auto mode, where `--allowedTools` removes nothing. The
  review session gets only Read, Glob, Grep and the inline comment tool, and sees only comments by Claude and the team.
- **Alternatives considered**: rely on the auto mode classifier (not a security boundary).

## Known limits

- GitHub may refuse very large diffs (about 20,000 lines or 300 files); the job then fails visibly.

- Trial PR #19 (closed) ran on GitHub with `github_token`: 3 of 3 seeded bugs inline, no repeats, superseded run cancelled.
  Not tried there: the Claude App token, `claude.yml`, a clean PR, a large diff. One local run found only 2 of the 3 bugs.
- Pull requests from forks get no secrets, so they are not reviewed.
- Duplicate skipping depends on the model's judgement.
