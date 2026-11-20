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
