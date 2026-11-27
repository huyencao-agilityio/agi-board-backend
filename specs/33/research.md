# Research: #33 Create Workspace

## R1. Workspace visibility (open to all accounts / restricted)

- **Decision:** not implemented. Recorded as an open question.
- **Rationale:** only the card mentions it. The BRD, proposal (F-03, F-05, OOS-10), `docs/database/schema.sql`,
  the `workspaces` table and screen spec WEB-D16 have no workspace visibility; only boards have Private/Workspace.
  "Open to all accounts" would also go against the access model (workspace content only for members and invitees,
  `visibleWorkspaceWhere`). Chosen by the user on 2026-11-27.
- **Alternatives considered:** store a `workspaces.visibility` column without access rules (a value nothing
  reads); store it and let `open` workspaces be seen by every account (permission change and data-exposure risk
  outside the BRD).
- **Open question (for the PO):** does the card's visibility rule replace the BRD, or should it be removed from
  the card? Until answered, the frontend dialog has no visibility control to send.

## R2. Name length

- **Decision:** keep trimmed 1–100 characters (`@MaxLength(100)`), as it is today.
- **Rationale:** the card says "no maximum length", but the user chose max 100 on 2026-11-27 after the security
  audit (specs/6 research D6, WEB-D16 decision #379, which replaces the older "no length limit" #231): the name
  is copied into the permanent audit log and shown on every member's Home. Confirmed again by the user on
  2026-11-27 for this ticket.
- **Alternatives considered:** remove the limit to match the card (lets one user bloat D1 and the audit log).

## R3. Line breaks in the name

- **Decision:** in the DTO transform, replace each run of line breaks (`\r`, `\n`, U+0085, U+2028, U+2029) with one space, then trim.
- **Rationale:** WEB-D16 #239: "stored as typed after trimming, line breaks become spaces". The frontend does
  it for typed input, but the API is the trust boundary and the name goes into the audit log, so the server
  stores the same form for any client. Runs before `@IsNotEmpty` and `@MaxLength`, so a name of only line breaks
  is rejected as blank and the length counts the stored form.
- **Alternatives considered:** frontend only (other clients could store multi-line names); collapse all
  whitespace (changes names the spec says are stored as typed).

## R4. What already exists (ticket #6)

| Card rule / AC | Where it is met |
|---|---|
| Name required, trimmed | `CreateWorkspaceDto`, DB `workspaces_name_check` |
| Duplicate names allowed | no unique index on `workspaces.name`; test to add (plan item 2) |
| Creator becomes admin | `WorkspacesService.create` batch, `workspace_members.role = 'admin'` |
| Starts empty | response `boardCount: 0`, `memberCount: 1`, `boards: []` |
| Workspace opens after create | `GET /workspaces/:workspaceId` (frontend navigates with the returned `id`) |
| Dialog, focus, spinner, field lock | frontend only |
