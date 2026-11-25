# Feature Specification: #18 Implement feature Forgot Password

**Card:** https://trello.com/c/VAr8qzqj/18-implement-feature-forgot-password
**List (status):** In Progress
**Labels:** Feature, Frontend, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-25 (GMT+7)

---

## Description

# Forgot Password

## Overview
Support the following user scenarios and functional requirements:

## User Value
Implement core functionality to support user workflows and system requirements.

## Scope
- Password reset request form
- Password reset link validation
- New password entry and validation
- Password reset confirmation and sign-in

## Business Rules
- Reset link valid for 30 minutes only
- Reset link is single-use (requesting new link voids old one)
- Password must meet strength requirements (8+ chars, 1 letter, 1 number)
- Password cannot contain email prefix
- A reset does not verify the email: an unverified account can request a link, stays unverified after the reset, and is sent to the code screen when it signs in (BRD §1, decision #42)
- Google-only accounts cannot request password reset: no reset link is created, the address gets an email saying to use Google sign-in, and the response is the same as for any other address (BRD §1)
- Successful reset signs out all existing sessions and lifts a sign-in lock (BRD §1, decision #31)
- Generic error messages for security (don't reveal if email exists)
- The email is trimmed and compared ignoring letter case, for the account lookup and the 60-second limit (decision #43)
- Within 60 seconds of a request for the same email, another request gets the same success response, sends no email and leaves the earlier link valid; this applies to every email, with or without an account (Clarifications 2026-11-25)
- A deactivated account that requests a reset gets no link and no email; the response is the same as for any other address (Clarifications 2026-11-25)
- A malformed, unknown, expired, used or voided link, and a link of an account deactivated since, all give "This link has expired or was already used." and set no password (decisions #45, #46)
- Checking a valid link returns the account's email, so the form can check the email-prefix rule live; an invalid link returns no account data. The rule is checked again on submit (Clarifications 2026-11-25)
- A new password equal to the old one is accepted (decision #45)

## Clarifications

### Session 2026-11-25

- Q: How should the system respond when someone requests a reset link again within 60 seconds for the same email? → A: Same success response and message; no new email is sent and the earlier link stays valid.
- Q: Is any email sent when an already deactivated account requests a reset link? → A: No link is created and no email is sent; same response as for any other address.
- Q: Where does the new password page get the account's email to check "Does not contain your email name" live? → A: The link check returns the account's email when the link is valid; the API checks the rule again on submit.

---

## Acceptance Criteria

### 1. Request password reset
- [ ] **Given** the sign-in page, **When** the user clicks Forgot password, **Then** WEB-14 opens with email field.
- [ ] **Given** valid email entered, **When** the user submits, **Then** reset email is sent and confirmation message appears.
- [ ] **Given** a reset was requested for an email less than 60 seconds ago, **When** it is requested again, **Then** the same confirmation appears, no email is sent and the earlier link still works.
- [ ] **Given** a deactivated account, **When** a reset is requested for its email, **Then** the same confirmation appears, no link is created and no email is sent.

### 2. Validate reset link and set new password
- [ ] **Given** a user receives password reset email, **When** they click the link, **Then** WEB-15 opens with new password form.
- [ ] **Given** the reset form, **When** the user enters a valid password, **Then** Submit button becomes enabled and password strength is shown.
- [ ] **Given** a valid link, **When** it is checked, **Then** the account's email is returned and the link is not used up.
- [ ] **Given** a malformed, unknown, expired, used or voided link, or a link of an account deactivated since, **When** it is checked or submitted, **Then** "This link has expired or was already used." is returned, with no account data and no password set.

### 3. Complete password reset
- [ ] **Given** a valid password entered and form submitted, **When** reset processes successfully, **Then** all sessions are signed out and user returns to sign-in screen with confirmation message.

---

## Checklists

None

## Comments

None

## Attachments / Links

None
