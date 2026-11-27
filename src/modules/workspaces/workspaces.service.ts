import { Injectable, NotFoundException } from '@nestjs/common';
import { getBindings } from '../../cloudflare';
import { sqlDate, uuidv7 } from '../../common/audit-log';
import type { SessionUser } from '../../common/guards/session.guard';
import { PrismaService } from '../../database/prisma.service';
import { toWorkspaceTile, workspaceTileSelect } from '../home/tiles';
import { visibleWorkspaceWhere } from '../permissions/board-access';

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

  async findOne(userId: string, workspaceId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ...visibleWorkspaceWhere(userId) },
      select: workspaceTileSelect(userId),
    });
    if (!workspace) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' });
    return toWorkspaceTile(workspace);
  }
}
