import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getBindings } from '../../cloudflare';
import { sqlDate, uuidv7 } from '../../common/audit-log';
import type { SessionUser } from '../../common/guards/session.guard';
import { PrismaService } from '../../database/prisma.service';
import { randomBoardColor } from '../boards/board-colors';
import { boardTileSelect, toBoardTile, toWorkspaceTile, workspaceTileSelect } from '../home/tiles';
import { canCreateBoard, visibleWorkspaceWhere } from '../permissions/board-access';
import type { CreateBoardDto } from './dto/create-board.dto';

/** The 6 default labels of a new board, with empty names (BRD §5; docs/database/schema-design.md). */
const DEFAULT_LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue'] as const;

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Workspace, creator as admin and the audit row, all or nothing (specs/6 research D6). */
  async create(user: SessionUser, name: string) {
    const { DB } = getBindings();
    const id = uuidv7();
    const now = sqlDate(new Date());
    await DB.batch([
      DB.prepare(
        'INSERT INTO workspaces (id, name, created_by_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
      ).bind(id, name, user.id, now),
      DB.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'admin', ?4, ?4)`,
      ).bind(uuidv7(), id, user.id, now),
      DB.prepare(
        `INSERT INTO audit_log_entries
           (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at)
         SELECT ?1, ?2, u.id, u.full_name, 'workspace_created', 'workspace', ?2, ?3, '{}', ?4, ?4
         FROM users u WHERE u.id = ?5`,
      ).bind(uuidv7(), id, name, now, user.id),
    ]);
    return { id, name, role: 'admin' as const, boardCount: 0, memberCount: 1, boards: [] };
  }

  /** Board, creator as admin, default labels and the board_created activity, all or nothing (specs/23 research R5). */
  async createBoard(user: SessionUser, workspaceId: string, dto: CreateBoardDto) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ...visibleWorkspaceWhere(user.id) },
      select: { workspaceMembers: { where: { userId: user.id }, select: { role: true } } },
    });
    if (!workspace) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' });
    if (!canCreateBoard({ workspaceRole: workspace.workspaceMembers[0]?.role ?? null })) {
      throw new ForbiddenException({
        code: 'BOARD_CREATE_FORBIDDEN',
        message: 'Only workspace admins can create boards',
      });
    }

    const { DB } = getBindings();
    const id = uuidv7();
    const now = sqlDate(new Date());
    // No lists: the card asks for an empty board "without built-in template columns".
    await DB.batch([
      DB.prepare(
        `INSERT INTO boards (id, workspace_id, name, visibility, background_color, created_by_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      ).bind(id, workspaceId, dto.name, dto.visibility ?? 'workspace', randomBoardColor(), user.id, now),
      DB.prepare(
        `INSERT INTO board_members (id, board_id, user_id, role, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'admin', ?4, ?4)`,
      ).bind(uuidv7(), id, user.id, now),
      ...DEFAULT_LABEL_COLORS.map((color) =>
        DB.prepare(
          `INSERT INTO labels (id, board_id, name, color_key, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?4, ?4)`,
        ).bind(uuidv7(), id, color, now),
      ),
      DB.prepare(
        `INSERT INTO activities (id, board_id, card_id, actor_id, type, data, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, 'board_created', '{}', ?4, ?4)`,
      ).bind(uuidv7(), id, user.id, now),
    ]);
    const board = await this.prisma.board.findUniqueOrThrow({ where: { id }, select: boardTileSelect(user.id) });
    return toBoardTile(board);
  }

  async findOne(userId: string, workspaceId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ...visibleWorkspaceWhere(userId) },
      select: workspaceTileSelect(userId),
    });
    if (!workspace) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' });
    return toWorkspaceTile(workspace);
  }
}
