---
name: create-pr
description: Create a GitHub pull request for agi-board-backend with the team's required format - title is the Trello ticket name (an imperative title), description has Ticket link / What / Why / How tested / Screenshots / Risk - plus ticket ids in commits and passing local checks. Use when the user asks to create a pull request, PR, merge request or MR, open/raise/submit a PR, or push a branch for review.
---

# Create a pull request

Branch flow: `main` (releases) ← `develop` (integration) ← feature branches. Feature PRs target **`develop`**;
only a release PR goes `develop` → `main`, and only when the user asks for it.

Every PR belongs to one Trello ticket. The ticket id is the card number on the board, written `#123`.

1. **Ticket.** Get the card number from the user (or the branch name / commits if they carry `#123`).
   Read the card with the Trello MCP tools (`trelloSearch` / `trelloReadCard`) to get its **exact name** and
   **URL**. If Trello is not available or the card is not found, ask the user for the name and link.
   Never invent a ticket number, name or link.
2. **Branch.** Never open a PR from `main` or `develop`. If on one of them, create a branch from `develop`
   (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`).
   Check `git status`: uncommitted changes are committed first or left out on purpose; ask if unclear.
3. **Commits carry the ticket id.** Format: `<type>(<scope>): #<id> <Imperative summary>`, e.g.
   `feat(boards): #123 Add board route guards`. Check `git log origin/develop..HEAD`; if a commit lacks the id,
   tell the user and offer to reword it (only on branches not yet merged).
4. **Base exists.** `git ls-remote --heads origin develop`. If `develop` does not exist on the remote, stop and tell
   the user: it must be created from `main` and pushed first.
5. **Checks.** Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:check`.
   Do not open the PR while one fails; report the output.
6. **Title.** The Trello card name, copied verbatim (it is written as an imperative, e.g.
   "Implement feature User Sign In"). Do not add the type prefix or the ticket number.
7. **Body.** Fill every section of `.github/pull_request_template.md` from the ticket, commits and diff
   (`git log origin/develop..HEAD`, `git diff origin/develop...HEAD --stat`):
   - **Ticket**: `[#123](<card URL>)`.
   - **What**: the change in a few bullets.
   - **Why**: the reason; link the spec (`specs/<NNN>-<slug>/spec.md` in the agi-board repo) if there is one.
   - **How tested**: commands actually run with their result, tests added. Never claim a check that was not run.
   - **Screenshots**: API/UI output if it helps, otherwise `N/A`.
   - **Risk**: what could break; for a migration name the tables touched, whether manual objects
     (`-- manual:` in migrations) are affected, and the rollback.
     End the body with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
8. **Confirm, then publish.** Show the title and body to the user and ask before pushing: pushing and creating
   the PR are visible to the team. Then `git push -u origin <branch>` and
   `gh pr create --base develop --title "<title>" --body-file <file>`. Return the PR URL.
   Never merge the PR and never enable auto-merge: merging is done by a reviewer.
   To change an existing PR, `gh pr edit` can fail on old `gh` versions (Projects classic error); use
   `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -f title="..." -F body=@<file>` instead.
