import type { Prisma } from '../../generated/prisma/client';
import type { BoardVisibility, MemberRole } from '../../generated/prisma/enums';

/**
 * The single source of board permission rules (risk R-02). Pure functions, so every rule
 * is covered by the table test next to this file. System roles are deliberately absent:
 * they never grant access to content (BRD §2).
 */
export interface BoardAccessFacts {
  /** Role in the board's workspace, or null for board-only members and outsiders. */
  workspaceRole: MemberRole | null;
  /** Role on the board itself, or null when not a board member. */
  boardRole: MemberRole | null;
  visibility: BoardVisibility;
}

export function canViewBoard({ workspaceRole, boardRole, visibility }: BoardAccessFacts): boolean {
  if (workspaceRole === 'admin' || boardRole !== null) return true;
  return workspaceRole === 'member' && visibility === 'workspace';
}

/** Only the admin of a workspace can create boards in it (BRD §2). */
export function canCreateBoard({ workspaceRole }: Pick<BoardAccessFacts, 'workspaceRole'>): boolean {
  return workspaceRole === 'admin';
}

/** Only workspace admins send, list, resend and revoke workspace invites (spec #21 Clarifications Q4). */
export function canManageWorkspaceInvites({ workspaceRole }: Pick<BoardAccessFacts, 'workspaceRole'>): boolean {
  return workspaceRole === 'admin';
}

/**
 * `canViewBoard` as a query filter, so lists never load hidden rows. Also hides closed boards and boards of archived
 * workspaces (specs/6 Q3). Keep the OR branches in step with `canViewBoard`.
 */
export function visibleBoardWhere(userId: string): Prisma.BoardWhereInput {
  return {
    closedAt: null,
    workspace: { archivedAt: null },
    OR: [
      { boardMembers: { some: { userId } } },
      { workspace: { workspaceMembers: { some: { userId, role: 'admin' } } } },
      { visibility: 'workspace', workspace: { workspaceMembers: { some: { userId } } } },
    ],
  };
}

/** Workspaces a user may see: not archived, and a workspace member or able to see one of its boards (BRD §2, §4). */
export function visibleWorkspaceWhere(userId: string): Prisma.WorkspaceWhereInput {
  return {
    archivedAt: null,
    OR: [{ workspaceMembers: { some: { userId } } }, { boards: { some: visibleBoardWhere(userId) } }],
  };
}

/** Invites a user may see and answer: pending, sent to their email, in an active workspace and on an open board. */
export function visibleInviteWhere(email: string): Prisma.InviteWhereInput {
  return {
    email,
    status: 'pending',
    workspace: { archivedAt: null },
    OR: [{ boardId: null }, { board: { closedAt: null } }],
  };
}
