---
name: create-pr
description: Create a GitHub pull request for agi-board-backend with the team's required body (What / Why / How tested / Screenshots / Risk), Conventional Commits and passing local checks. Use when the user asks to create a pull request, PR, merge request or MR, open/raise/submit a PR, or push a branch for review.
---

# Create a pull request

Branch flow: `main` (releases) ← `develop` (integration) ← feature branches. Feature PRs target **`develop`**;
only a release PR goes `develop` → `main`, and only when the user asks for it.

1. **Branch.** Never open a PR from `main` or `develop`. If on one of them, create a branch from `develop`
   (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`).
   Check `git status`: uncommitted changes are committed first (Conventional Commits) or left out on purpose; ask if unclear.
2. **Base exists.** `git ls-remote --heads origin develop`. If `develop` does not exist on the remote, stop and tell
   the user: it must be created from `main` and pushed first.
3. **Checks.** Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:check`.
   Do not open the PR while one fails; report the output.
4. **Title.** Conventional Commit format, <= 72 chars, e.g. `feat(boards): create and close boards`.
   For a single-commit branch reuse that commit's subject.
5. **Body.** Fill every section of `.github/pull_request_template.md` from the commits and diff
   (`git log origin/develop..HEAD`, `git diff origin/develop...HEAD --stat`):
   - **What**: the change in a few bullets.
   - **Why**: the reason; link the spec (`specs/<NNN>-<slug>/spec.md` in the agi-board repo) or ticket.
   - **How tested**: commands actually run with their result, tests added. Never claim a check that was not run.
   - **Screenshots**: API/UI output if it helps, otherwise `N/A`.
   - **Risk**: what could break; for a migration name the tables touched, whether manual objects
     (`-- manual:` in migrations) are affected, and the rollback.
     End the body with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
6. **Confirm, then publish.** Show the title and body to the user and ask before pushing: pushing and creating
   the PR are visible to the team. Then `git push -u origin <branch>` and
   `gh pr create --base develop --title "<title>" --body-file <file>`. Return the PR URL.
   Never merge the PR and never enable auto-merge: merging is done by a reviewer.
