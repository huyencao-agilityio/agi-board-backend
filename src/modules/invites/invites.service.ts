import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getBindings } from '../../cloudflare';
import { sqlDate, uuidv7 } from '../../common/audit-log';
import type { SessionUser } from '../../common/guards/session.guard';
import { PrismaService } from '../../database/prisma.service';
import { visibleInviteWhere } from '../permissions/board-access';

const inviteNotFound = () => new NotFoundException({ code: 'INVITE_NOT_FOUND', message: 'Invite not found' });
const inviteExpired = () => new ConflictException({ code: 'INVITE_EXPIRED', message: 'This invite has expired' });

/**
 * True only once statement 1 of the accept batch has marked the invite accepted by this user at this instant, so the
 * membership inserts write nothing when another request won the race. Binds: ?1 invite id, ?2 user id, ?3 now.
 */
const ACCEPTED = `EXISTS (SELECT 1 FROM invites WHERE id = ?1 AND status = 'accepted' AND responded_by_id = ?2 AND responded_at = ?3)`;

/** The invitee's side of invites: accept or decline on Home (specs/6 research D7). */
@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async accept(user: SessionUser, inviteId: string) {
    const invite = await this.prisma.invite.findFirst({
      where: { id: inviteId, ...visibleInviteWhere(user.email) },
      select: { id: true, workspaceId: true, boardId: true, role: true, expiresAt: true },
    });
    if (!invite) throw inviteNotFound();
    const nowDate = new Date();
    if (invite.expiresAt <= nowDate) throw inviteExpired();

    const { DB } = getBindings();
    const now = sqlDate(nowDate);
    const guard = [invite.id, user.id, now];
    const statements = [
      DB.prepare(
        `UPDATE invites SET status = 'accepted', responded_at = ?3, responded_by_id = ?2, updated_at = ?3
         WHERE id = ?1 AND status = 'pending' AND expires_at > ?3`,
      ).bind(...guard),
    ];
    // Inserted only if that board invite (?7) was accepted by this request, so a concurrent decline wins.
    const addBoardMember = (boardInviteId: string, boardId: string, role: string) =>
      DB.prepare(
        `INSERT INTO board_members (id, board_id, user_id, role, created_at, updated_at)
         SELECT ?4, ?5, ?2, ?6, ?3, ?3
         WHERE EXISTS (SELECT 1 FROM invites WHERE id = ?7 AND status = 'accepted' AND responded_by_id = ?2 AND responded_at = ?3)
         ON CONFLICT (board_id, user_id) DO NOTHING`,
      ).bind(...guard, uuidv7(), boardId, role, boardInviteId);

    if (invite.boardId) {
      statements.push(addBoardMember(invite.id, invite.boardId, invite.role));
    } else {
      // Board roles the person already has are kept (BRD §3).
      statements.push(
        DB.prepare(
          `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
           SELECT ?4, ?5, ?2, ?6, ?3, ?3 WHERE ${ACCEPTED}
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        ).bind(...guard, uuidv7(), invite.workspaceId, invite.role),
      );
      // BRD §3 default: a pending board invite for someone who then joins the workspace is accepted automatically.
      const boardInvites = await this.prisma.invite.findMany({
        where: {
          workspaceId: invite.workspaceId,
          email: user.email,
          status: 'pending',
          expiresAt: { gt: nowDate },
          boardId: { not: null },
          board: { closedAt: null },
        },
        select: { id: true, boardId: true, role: true },
      });
      for (const b of boardInvites) {
        statements.push(
          DB.prepare(
            `UPDATE invites SET status = 'accepted', responded_at = ?3, responded_by_id = ?2, updated_at = ?3
             WHERE id = ?4 AND status = 'pending' AND ${ACCEPTED}`,
          ).bind(...guard, b.id),
          addBoardMember(b.id, b.boardId!, b.role), // non-null: filtered above
        );
      }
    }

    const [accepted] = await DB.batch(statements);
    if (accepted.meta.changes === 0) {
      // Lost a race: answered or expired in the meantime.
      const latest = await this.prisma.invite.findUnique({
        where: { id: invite.id },
        select: { status: true, expiresAt: true },
      });
      if (latest?.status === 'pending' && latest.expiresAt <= new Date()) throw inviteExpired();
      throw inviteNotFound();
    }
    return { workspaceId: invite.workspaceId, boardId: invite.boardId };
  }

  /** Allowed on expired invites too: declining removes the row from Home (BRD §3). */
  async decline(user: SessionUser, inviteId: string) {
    const { count } = await this.prisma.invite.updateMany({
      where: { id: inviteId, ...visibleInviteWhere(user.email) },
      data: { status: 'declined', respondedAt: new Date(), respondedById: user.id },
    });
    if (count === 0) throw inviteNotFound();
  }
}
