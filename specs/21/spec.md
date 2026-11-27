# Feature Specification: #21 Implement feature Invite to Workspace

**Card:** https://trello.com/c/TROWNGKK/21-implement-feature-invite-to-workspace
**List (status):** In Progress
**Labels:** Feature, Phase 3, Backend, Frontend, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-27 (GMT+7)

---

## Description

# Invite to Workspace

## Overview
Support the following user scenarios and functional requirements:

## User Value
Implement core functionality to support user workflows and system requirements.

## Scope
- Send workspace invites with role assignment
- Manage invite expiration and renewal
- Accept or decline workspace invites
- Track invited members

## Business Rules
- Workspace admins can invite people via email
- Only workspace admins can see the pending invites list (email, role, expiry, inviter) and resend or revoke invites; a non-member gets 404 `WORKSPACE_NOT_FOUND`, a non-admin member gets 403 (house pattern, as for board creation)
- Invites expire 14 days after they are sent (or last resent)
- Invitees must sign in with invited email address
- Any unanswered invite (still valid or expired) can be resent or revoked; Resend sends the email again, sets `expiresAt` to now + 14 days and updates `lastSentAt`, keeping the same invite id and role
- Resend is limited to once per 60 seconds per invite (measured from `lastSentAt`); an earlier Resend is rejected with `429 RESEND_COOLDOWN` and the seconds left to wait
- Creating an invite is also limited: if the same address was sent an invite to this workspace less than 60 seconds ago (now revoked, declined or accepted), `429 RESEND_COOLDOWN`; a person may create at most 50 new invites per hour across workspaces, then `429 INVITE_RATE_LIMITED`
- Invites tied to email, not to account
- Inviting an email that already belongs to a workspace member is rejected with `409 ALREADY_MEMBER`
- Inviting an email that already has a pending invite to the workspace is rejected with `409 INVITE_PENDING`; the admin resends or revokes the existing invite instead
- Invite email sent to target address
- Accepting invite adds member with specified role

---

## Clarifications

### Session 2026-11-27

- Q: If an admin invites an email that already has a pending invite to the workspace, or belongs to an existing member, what happens? → A: Existing member → `409 ALREADY_MEMBER`; pending invite exists → `409 INVITE_PENDING`; the admin uses Resend/Revoke on the existing invite.
- Q: Is the invite lifetime fixed at 14 days, and what does Resend do? → A: Fixed 14 days; Resend works on any unanswered invite (valid or expired): re-sends the email, sets `expiresAt` = now + 14 days, updates `lastSentAt`, same invite id and role.
- Q: Should email sending be rate limited so an admin cannot spam an address via Resend? → A: Yes, 60-second cooldown per invite from `lastSentAt`; earlier Resend → `429 RESEND_COOLDOWN` with seconds remaining.
- Q: Who in a workspace can see the pending invites list (and so the invitees' emails)? → A: Workspace admins only; other members cannot list, resend or revoke invites.
- Q: (after security review) How is create → revoke → create email spam limited? → A: 60-second cooldown on create per workspace and email over answered/revoked invites (`429 RESEND_COOLDOWN`), plus 50 new invites per hour per sender (`429 INVITE_RATE_LIMITED`).

---

## Acceptance Criteria

### 1. Send workspace invites
- [ ] **Given** workspace admin opens invite dialog, **When** they enter email and select role, **Then** invite is sent and recipient gets email.
- [ ] **Given** valid email and role selected, **When** admin clicks Send, **Then** invite appears in pending list.

### 2. Manage invites
- [ ] **Given** pending invites exist, **When** workspace admin views Members, **Then** they can resend or revoke each invite.
- [ ] **Given** an expired invite, **When** admin clicks Resend, **Then** expiration resets to 14 days.

### 3. Accept workspace invite
- [ ] **Given** a user receives workspace invite email, **When** they sign in with that email, **Then** invite appears on home page.
- [ ] **Given** pending invite displayed, **When** user clicks Accept, **Then** they join workspace with specified role.

### 4. Decline invite
- [ ] **Given** a pending workspace invite, **When** user clicks Decline, **Then** invite is removed from their home page.

---

## Checklists

None

## Comments

None

## Attachments / Links

None
