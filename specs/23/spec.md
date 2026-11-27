# Feature Specification: #23 Implement feature Create Board

**Card:** https://trello.com/c/zGMzmLuO/23-implement-feature-create-board
**List (status):** In Progress
**Labels:** Feature, Phase 3, Backend, Frontend, Sprint 1
**Members:** Huyen Cao
**Due:** —
**Pulled:** 2026-11-27 (GMT+7)

---

## Clarifications

### Session 2026-11-27

- Q: Who can see a new board? Are all workspace members written as board members? → A: Only the creator is written to `board_members` (role `admin`). Access for everyone else comes from the visibility and the workspace role (BRD §2, §3): **workspace admins** see and administer every board in the workspace, private ones included; **workspace members** see and edit every board with visibility `Workspace`, but a `Private` board only if they are added to it; **board-only members** see only the boards they were added to. "All workspace members as members" in the card means this visibility-based access. It does not mean writing one row per member, because then new workspace members would not get access and a Private board would no longer be private.
- Q: Who can create a board? → A: Only a **workspace admin** of the target workspace (BRD §2: "Only the admin of a workspace can create boards"). The workspace is the one whose `Create new board` tile was clicked. There is no workspace picker (BRD §2), so "Choose visibility and workspace" in the card's Scope means only visibility. Workspace members, board-only members and outsiders cannot create a board; return 404 for a workspace they cannot see (AGENTS.md: use 404, not 403).
- Q: Is the board name really unbounded? → A: There is no product limit, but the server caps the name at 512 characters as an abuse bound (security review M1, user decision on 2026-11-27). Over 512 characters returns 400.
- Q: Who can open a Private board (AC 3)? → A: The board's members (at creation, only the creator, as admin) and every workspace admin of that workspace (BRD §2: workspace admin "acts as admin of every board in the workspace, including private ones"). This rule already exists as `canViewBoard` / `visibleBoardWhere` in `src/modules/permissions/board-access.ts`.

---

## Description

# Create Board

## Overview
Support the following user scenarios and functional requirements:

## User Value
Implement core functionality to support user workflows and system requirements.

## Scope
- Trigger create board dialog
- Enter board name
- Choose visibility and workspace
- Create and open the board

## Business Rules
- The dialog MUST open from the `Create board` button in the workspace dropdown and MUST show the title `Create board`, a `Name` field, a `Visibility` section and the buttons `Cancel` (default) and `Create`
- `Name` MUST require at least one non-space character, with no maximum length, and MUST be trimmed of leading and trailing spaces before saving; `Create` MUST be disabled until the name is valid
- `Visibility` MUST show `Workspace` (default) and `Private`; hovering MUST show tooltips explaining the difference
- `Create` MUST show a spinner while processing and lock all fields
- Creating a new board MUST create a workspace board with the chosen name, the current person as admin, all workspace members as members with the default permissions, an initially empty board without built-in template columns, and move the person to the new board
- `Cancel`, `Esc` and clicking outside MUST close the dialog without creating anything and return to the workspace view

---

## Acceptance Criteria

### 1. Enter board name
- [ ] **Given** the dialog just opened, **Then** `Name` is empty and `Create` is disabled.
- [ ] **Given** a valid name (at least 1 non-space character), **Then** `Create` is enabled;
**When** clicked,
**Then** only a spinner shows in the button, all fields are locked while processing.

### 2. Create and open the board
- [ ] **Given** the name is valid, **Then** a new board is created with that name, the person is an admin, all workspace members are members (with default permissions), and the board opens.
- [ ] **Given** the new board opens, **Then** it shows the board header, navigation, and an empty state (proposed) with no built-in template columns.

### 3. Choose visibility
- [ ] **Given** the dialog, **Then** `Visibility` shows `Workspace` selected and `Private` unselected.
- [ ] **Given** a private board in the workspace, **Then** only the board admin and the person who created it can open it.

### 4. Cancel without creating
- [ ] **Given** the dialog, **When** the person clicks `Cancel`,
**Then** it closes, nothing is created and they stay in the workspace view.
- [ ] **Given** the dialog, **When** they press `Esc` or click outside it,
**Then** it closes the same way.

---

## Checklists

None

## Comments

None

## Attachments / Links

None
