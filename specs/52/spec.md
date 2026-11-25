# Feature Specification: #52 Post automatic Claude code review as inline PR comments in the backend

**Card:** https://trello.com/c/cZEkazPF/52-post-automatic-claude-code-review-as-inline-pr-comments-in-the-backend
**List (status):** In Progress
**Labels:** Backend, Phase 3, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-25 (Asia/Saigon)

---

## Description

# Post automatic Claude code review as inline PR comments in the backend

## Overview

The automatic review set up in ticket #47 runs on every backend PR into `develop`, but it posts only one summary comment ("No issues found", seen on PRs #15 to #18) and no comment on the code lines. The logged run on PR #18 finished in 5 turns (about 25 seconds). Mentioning `@claude review` also returns only a summary, because `claude.yml` does not allow the inline comment tool.

## Scope

- `claude-code-review.yml`: replace the `code-review` plugin with a review prompt based on `AGENTS.md`, `.claude/rules/` and the `code-reviewer` agent
- `claude-code-review.yml`: check out the PR head, so line numbers match the diff on GitHub
- `claude-code-review.yml`: save the full diff and the existing inline comments to files before the review, so the diff is not truncated
- `claude-code-review.yml`: post each finding as an inline comment on its line; no summary comment
- `claude-code-review.yml`: skip findings already reported by an inline comment, and cancel a running review when a new commit is pushed
- `claude.yml`: allow inline comments for `@claude review`
- Out of scope: the frontend repo, blocking the merge on findings, and updating the outdated PostgreSQL notes in `.claude/agents/code-reviewer.md`

## Acceptance Criteria

- **Given** a PR into `develop` is opened, updated, reopened or marked ready for review, **When** the workflow runs, **Then** the review starts without an `@claude` mention.
- **Given** the review finds a problem, **When** it finishes, **Then** the problem is an inline comment on the changed line, with its severity, impact and fix.
- **Given** the review finds several problems, **When** it finishes, **Then** each one has its own inline comment and no summary comment is posted.
- **Given** the review finds no problem, **When** it finishes, **Then** nothing is posted and the job log lists the reviewed files.
- **Given** a large diff, **When** the review runs, **Then** every changed file except lock files is reviewed.
- **Given** an existing inline comment already reports a problem, **When** a new commit is pushed, **Then** the same problem is not posted again.
- **Given** a user comments `@claude review` on a PR, **When** Claude replies, **Then** findings are inline comments and the tracking comment only says how many were posted.

## Verification

`claude-code-action` can skip a PR whose workflow file differs from the one on `develop`. After merge, open a new PR with a deliberate bug and check that the inline comment is on the right line.

---

## Acceptance Criteria

- [ ] **Given** a PR into `develop` is opened, updated, reopened or marked ready for review, **When** the workflow runs, **Then** the review starts without an `@claude` mention.
- [ ] **Given** the review finds a problem, **When** it finishes, **Then** the problem is an inline comment on the changed line, with its severity, impact and fix.
- [ ] **Given** the review finds several problems, **When** it finishes, **Then** each one has its own inline comment and no summary comment is posted.
- [ ] **Given** the review finds no problem, **When** it finishes, **Then** nothing is posted and the job log lists the reviewed files.
- [ ] **Given** a large diff, **When** the review runs, **Then** every changed file except lock files is reviewed.
- [ ] **Given** an existing inline comment already reports a problem, **When** a new commit is pushed, **Then** the same problem is not posted again.
- [ ] **Given** a user comments `@claude review` on a PR, **When** Claude replies, **Then** findings are inline comments and the tracking comment only says how many were posted.

---

## Checklists

None

## Comments

None

## Attachments / Links

None
