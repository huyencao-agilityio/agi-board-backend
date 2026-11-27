# Feature Specification: #56 Decide and implement audit log for self-service account security actions

**Card:** https://trello.com/c/sBfIWjhL/56-decide-and-implement-audit-log-for-self-service-account-security-actions
**List (status):** In Progress
**Labels:** Phase 3, Backend, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-27 (GMT+7)

---

## Description

# Audit log for self-service account security actions

## Overview
Follow-up from the security review of #22 (Profile and Account Settings, finding M2). Today no account-security flow writes an `audit_log_entries` row: change password, sign out one session, sign out all other sessions (#22), password reset and logout. If an attacker with a stolen session changes the password or ends the owner's other sessions, nothing records it for support or incident review.

## Decision needed first (Discovery)
- BRD §10 (Audit log) lists **admin actions** only (role changes, removals, deactivations, archive/restore, visibility, invites, board copies, permanent deletions) and Admin console actions. Self-service actions are not listed.
- `.claude/rules/security.md` says "Admin and security-relevant actions write an `audit_log_entries` row in the same transaction as the change".
- The `AuditAction` enum has `sign_out_all_sessions`, `send_password_reset_link`, `resend_verification_code` (admin actions) but nothing for a user changing their own password or ending their own sessions.
- Question for the project owner: should self-service security actions be audited? If yes, which ones, and who may read those rows (there is no system-wide audit screen in the MVP)?

## Scope (if approved)
- Add audit actions for the approved events: `password_changed`, `session_signed_out`, `other_sessions_signed_out`, `password_reset_completed` (approved 2026-11-27; logout `POST /auth/logout` is not audited).
- Write the row in the same `DB.batch` as the change (D1 has no atomic Prisma transaction).
- Write only: no read API for these rows in this ticket; support reads them directly in D1. Reading is a later ticket.
- Keep `data` to ids and action data only (no emails, names in `data`, IPs or user agents), per the personal-data rules. Exact `data`: `session_signed_out` → `{ "sessionId": "<id>" }`; `password_changed`, `other_sessions_signed_out`, `password_reset_completed` → `{}`.

## Suggested implementation
- `POST /auth/change-password`: append `INSERT INTO audit_log_entries (...)` to the existing batch in `AccountSecurityService.changePassword`, guarded by the same "new hash is in place" `EXISTS` condition, so a lost race writes no row.
- `DELETE /auth/sessions/:sessionId` and `DELETE /auth/sessions`: move the `updateMany` + audit insert into one `DB.batch`; only insert when sessions were actually ended (guard with `EXISTS` on the ended rows, or check `changes`).
- `POST /auth/reset-password`: add the insert to `PasswordResetService.applyReset`'s batch, guarded by `LINK_IS_VALID` like its other statements.
- `actor_id` / `target_id` = the user; `workspace_id` = NULL; `actor_name` / `target_label` = the user's full name at the time (the table already copies names).
- The `audit_action` enum is not enforced by D1: adding values needs no SQL; run `pnpm db:check`.
- E2E: one row per action with the right ids and no personal data in `data`; no row when the action fails (wrong current password, 404 session, invalid link).

## References
- #22 security review (M2), specs/22/research.md D6–D8 in agi-board-backend
- BRD `docs/brd/requirements.md` §10, `.claude/rules/security.md` "Logging and audit"

---

## Clarifications

### Session 2026-11-27

- Q: Which self-service account security actions write an `audit_log_entries` row? → A: Four: change password, sign out one session, sign out all other sessions, password reset completed. Logout is not audited.
- Q: Who may read these audit rows in this ticket? → A: Nobody through the API; write only, support queries D1 directly. A read API is a later ticket.
- Q: What does each audit row hold in `data`? → A: Minimal: `session_signed_out` → `{ "sessionId": "<id>" }`; the other three → `{}`.

---

## Acceptance Criteria

- [ ] **Given** the owner decided which self-service actions are audited (change password, sign out one session, sign out all other sessions, password reset completed), **When** a user performs one of them successfully, **Then** exactly one `audit_log_entries` row is written in the same batch as the change.
- [ ] **Given** the action fails or loses a race, **When** the request ends, **Then** no audit row is written.
- [ ] **Given** an audit row, **When** it is read, **Then** `data` holds ids and action data only, no emails, IPs or user agents.

---

## Checklists

None

## Comments

None

## Attachments / Links

None
