import { Injectable, NotFoundException } from '@nestjs/common';
import { getBindings } from '../../cloudflare';
import { sqlDate, uuidv7 } from '../../common/audit-log';
import { PrismaService } from '../../database/prisma.service';
import { visibleBoardWhere } from '../permissions/board-access';

/** Per-user board marks that feed Home: stars and recent views (specs/6 research D5). */
@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  async star(userId: string, boardId: string) {
    await this.assertVisible(userId, boardId);
    const { DB } = getBindings();
    const now = sqlDate(new Date());
    await DB.prepare(
      `INSERT INTO board_stars (id, user_id, board_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (user_id, board_id) DO NOTHING`,
    )
      .bind(uuidv7(), userId, boardId, now)
      .run();
  }

  /** No access check: it only removes the caller's own row, also after access was lost. */
  async unstar(userId: string, boardId: string) {
    await this.prisma.boardStar.deleteMany({ where: { userId, boardId } });
  }

  async recordView(userId: string, boardId: string) {
    await this.assertVisible(userId, boardId);
    const { DB } = getBindings();
    const now = sqlDate(new Date());
    await DB.prepare(
      `INSERT INTO board_views (id, user_id, board_id, last_viewed_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4, ?4)
       ON CONFLICT (user_id, board_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at, updated_at = excluded.updated_at`,
    )
      .bind(uuidv7(), userId, boardId, now)
      .run();
  }

  private async assertVisible(userId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...visibleBoardWhere(userId) },
      select: { id: true },
    });
    if (!board) throw new NotFoundException({ code: 'BOARD_NOT_FOUND', message: 'Board not found' });
  }
}
