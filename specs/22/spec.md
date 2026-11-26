# Feature Specification: #22 Implement feature Profile and Account Settings

**Card:** https://trello.com/c/j51SdTvw/22-implement-feature-profile-and-account-settings
**List (status):** In Progress
**Labels:** Feature, Phase 3, Backend, Frontend, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-26 (GMT+7)

---

## Description

# Profile and Account Settings

## Overview
Support the following user scenarios and functional requirements:

## User Value
Implement core functionality to support user workflows and system requirements.

## Scope
- Display and edit user profile information
- Manage account security settings
- Handle password changes
- Track active sessions

## Business Rules
- Users can edit full name (at least 1 non-space character required)
- Default avatar shows user initials
- Users can upload profile photo
- Password change requires current password verification
- Password must meet strength requirements
- New password must differ from the current password (confirmed by the PO on 2026-11-26)
- Password change signs out other sessions
- Google sign-in status shown but not modifiable
- Active sessions can be listed and individually signed out

---

## Clarifications

### Session 2026-11-26

- Q: Does this ticket also cover the BRD items missing from the card (remove avatar, "Sign out of all other sessions", current session marked)? → A: Yes, all three (BRD `requirements.md` line 22, Agreed).
- Q: Which file types and size are allowed for an avatar upload? → A: JPEG/JPG, PNG, WebP, GIF only; max 5 MB.
- Q: Should the session list return the raw user agent or parsed browser/OS? → A: Raw `userAgent`, `lastActiveAt`, `createdAt`, `isCurrent`; the frontend parses it (no IP returned).
- Q: How are repeated wrong current-password attempts on password change handled? → A: Separate rate limit on the change-password endpoint (5 wrong attempts / 15 minutes per user → 429); the account is not locked.
- Q: When an avatar is replaced or removed, is the old R2 object deleted? → A: Yes, right after the database update succeeds; a failed R2 delete is only logged, not returned as an error.
- Q: Should the backend refuse a new password equal to the current one? → A: Yes (PO, 2026-11-26): 400 `VALIDATION_FAILED` with the rule message `password must differ from the current password` (proposed), listed with the other new-password rules.

---

## Acceptance Criteria

### 1. Edit profile information
- [ ] **Given** user opens Profile settings, **When** they view their information, **Then** name, email, and avatar are displayed.
- [ ] **Given** profile editing enabled, **When** user changes their name, **Then** changes are saved and reflected immediately.

### 2. Manage account security
- [ ] **Given** account has a password, **When** user opens password section, **Then** current password field appears.
- [ ] **Given** current password verified, **When** user enters new password meeting requirements, **Then** password is updated and other sessions are signed out.
- [ ] (clarified) **Given** current password verified, **When** the new password equals the current one, **Then** the change is refused and nothing changes.
- [ ] (clarified) **Given** user enters a wrong current password 5 times within 15 minutes, **When** they try again, **Then** the request is rejected with 429 and the account is not locked (sign-in still works).

### 3. Manage active sessions
- [ ] **Given** user views active sessions, **When** they see the list, **Then** each session shows device/browser info and last active time (API returns the raw `userAgent`, `lastActiveAt`, `createdAt`, `isCurrent`).
- [ ] (clarified) **Given** user views active sessions, **When** they see the list, **Then** the current session is marked.
- [ ] (clarified) **Given** user has other active sessions, **When** they choose `Sign out` on one session, **Then** only that session ends.
- [ ] (clarified) **Given** user has other active sessions, **When** they choose `Sign out of all other sessions`, **Then** every session except the current one ends.

### 4. Avatar (clarified)
- [ ] **Given** user has no photo, **When** they view their profile, **Then** the default initials avatar is used.
- [ ] **Given** user uploads a photo, **When** the upload succeeds, **Then** the photo replaces the initials avatar.
- [ ] **Given** user uploads a file that is not JPEG/JPG, PNG, WebP or GIF, or is larger than 5 MB, **When** they submit it, **Then** the upload is rejected and the current avatar is unchanged.
- [ ] **Given** user has a photo, **When** they remove it, **Then** the initials avatar is shown again.
- [ ] **Given** user replaces or removes a photo, **When** the database update succeeds, **Then** the old image object is deleted from storage (a failed delete is logged, the request still succeeds).

---

## Checklists

None

## Comments

None

## Attachments / Links

None
