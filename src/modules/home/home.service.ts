import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../../common/guards/session.guard';
import { PrismaService } from '../../database/prisma.service';
import { visibleBoardWhere, visibleInviteWhere, visibleWorkspaceWhere } from '../permissions/board-access';
import { boardTileSelect, toBoardTile, toWorkspaceTile, workspaceTileSelect } from './tiles';

const RECENT_LIMIT = 6;

/** The Home page read model (specs/6 research D2–D4). */
@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getHome(user: SessionUser) {
    const userId = user.id;
    const now = new Date();
    // shortcut: unpaginated, bounded by the user's memberships; add ?limit/cursor if users reach hundreds of boards.
    const [stars, views, workspaces, invites, archivedAdmin] = await Promise.all([
      this.prisma.boardStar.findMany({
        where: { userId, board: visibleBoardWhere(userId) },
        orderBy: { createdAt: 'asc' },
        select: { board: { select: boardTileSelect(userId) } },
      }),
      this.prisma.boardView.findMany({
        // Independent of stars: a starred board also shows here if it is among the 6 latest viewed (Q4, revised).
        where: { userId, board: visibleBoardWhere(userId) },
        orderBy: { lastViewedAt: 'desc' },
        take: RECENT_LIMIT,
        select: { board: { select: boardTileSelect(userId) } },
      }),
      this.prisma.workspace.findMany({
        where: visibleWorkspaceWhere(userId),
        orderBy: { name: 'asc' },
        select: workspaceTileSelect(userId),
      }),
      this.prisma.invite.findMany({
        where: visibleInviteWhere(user.email),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          boardId: true,
          role: true,
          expiresAt: true,
          workspace: { select: { id: true, name: true } },
          board: { select: { id: true, name: true } },
          invitedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.workspaceMember.count({
        where: { userId, role: 'admin', workspace: { archivedAt: { not: null } } },
      }),
    ]);

    return {
      starred: stars.map((s) => toBoardTile(s.board)),
      recent: views.map((v) => toBoardTile(v.board)),
      workspaces: workspaces.map(toWorkspaceTile),
      invites: invites.map((i) => ({
        id: i.id,
        type: i.boardId === null ? ('workspace' as const) : ('board' as const),
        workspace: i.workspace,
        board: i.board,
        role: i.role,
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt.toISOString(),
        expired: i.expiresAt <= now,
      })),
      // Shows the `View archived workspaces` link (UI WEB-03, decision #372).
      hasArchivedWorkspaces: archivedAdmin > 0,
    };
  }
}
