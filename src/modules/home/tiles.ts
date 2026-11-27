import type { Prisma } from '../../generated/prisma/client';
import { visibleBoardWhere } from '../permissions/board-access';

/** Board fields shown on a tile (specs/6 contracts `BoardTile`). */
export const boardTileSelect = (userId: string) =>
  ({
    id: true,
    name: true,
    workspaceId: true,
    visibility: true,
    backgroundKey: true,
    backgroundColor: true,
    workspace: { select: { name: true } },
    boardStars: { where: { userId }, select: { id: true } },
  }) satisfies Prisma.BoardSelect;

type BoardTileRow = Prisma.BoardGetPayload<{ select: ReturnType<typeof boardTileSelect> }>;

export const toBoardTile = (b: BoardTileRow) => ({
  id: b.id,
  name: b.name,
  workspaceId: b.workspaceId,
  workspaceName: b.workspace.name,
  visibility: b.visibility,
  backgroundKey: b.backgroundKey,
  // The tile shows the image if there is one, else `backgroundColor` (decision #376). shortcut: uploaded backgrounds
  // (background_object_key) give null until the upload-background ticket adds a permission-checked route for them.
  backgroundThumbnailUrl: b.backgroundKey
    ? `/api/v1/board-backgrounds/${encodeURIComponent(b.backgroundKey)}/thumbnail`
    : null,
  backgroundColor: b.backgroundColor,
  starred: b.boardStars.length > 0,
});

/** Workspace fields for a tile, with only the boards the viewer can access (specs/6 contracts `WorkspaceTile`). */
export const workspaceTileSelect = (userId: string) =>
  ({
    id: true,
    name: true,
    workspaceMembers: { where: { userId }, select: { role: true } },
    _count: { select: { workspaceMembers: true } },
    boards: { where: visibleBoardWhere(userId), orderBy: { name: 'asc' }, select: boardTileSelect(userId) },
  }) satisfies Prisma.WorkspaceSelect;

type WorkspaceTileRow = Prisma.WorkspaceGetPayload<{ select: ReturnType<typeof workspaceTileSelect> }>;

export const toWorkspaceTile = (w: WorkspaceTileRow) => {
  const role = w.workspaceMembers[0]?.role ?? null;
  return {
    id: w.id,
    name: w.name,
    role,
    boardCount: w.boards.length,
    // A board-only member sees the workspace name and their boards, nothing else of it (BRD §2).
    memberCount: role === null ? null : w._count.workspaceMembers,
    boards: w.boards.map(toBoardTile),
  };
};
