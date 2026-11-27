import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { getBindings } from '../../cloudflare';
import { sqlDate, uuidv7 } from '../../common/audit-log';
import type { SessionUser } from '../../common/guards/session.guard';
import { DAY_MS } from '../../common/session-cookie';
import { isD1UniqueConflict } from '../../database/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { EmailService } from '../email/email.service';
import { canManageWorkspaceInvites, visibleInviteWhere, visibleWorkspaceWhere } from '../permissions/board-access';
import type { CreateInviteDto } from './dto/create-invite.dto';
import type { ListInvitesDto } from './dto/list-invites.dto';

const INVITE_DAYS = 14;
const RESEND_COOLDOWN_SECONDS = 60;
const DEFAULT_LIST_LIMIT = 50;
/** New invites one person may send per hour, across workspaces (abuse bound chosen by the user, 2026-11-27). */
const INVITES_PER_HOUR = 50;
const HOUR_MS = 60 * 60 * 1000;

const inviteNotFound = () => new NotFoundException({ code: 'INVITE_NOT_FOUND', message: 'Invite not found' });
const inviteExpired = () => new ConflictException({ code: 'INVITE_EXPIRED', message: 'This invite has expired' });

const inviteItemSelect = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  lastSentAt: true,
  invitedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.InviteSelect;
type InviteItemRow = Prisma.InviteGetPayload<{ select: typeof inviteItemSelect }>;
const toInviteItem = (row: InviteItemRow, now: Date) => ({ ...row, expired: row.expiresAt <= now });
const expiryFrom = (now: Date) => new Date(now.getTime() + INVITE_DAYS * DAY_MS);
const cooldownStart = (now: Date) => new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000);
const resendCooldown = (lastSentAt: Date, now: Date) => {
  const elapsed = (now.getTime() - lastSentAt.getTime()) / 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
  return new HttpException(
    { code: 'RESEND_COOLDOWN', message: 'Wait before sending this invite again', details: { retryAfterSeconds } },
    429,
  );
};

/**
 * True only once statement 1 of the accept batch has marked the invite accepted by this user at this instant, so the
 * membership inserts write nothing when another request won the race. Binds: ?1 invite id, ?2 user id, ?3 now.
 */
const ACCEPTED = `EXISTS (SELECT 1 FROM invites WHERE id = ?1 AND status = 'accepted' AND responded_by_id = ?2 AND responded_at = ?3)`;

/** The invitee's side (accept or decline on Home, specs/6 research D7) and the admin's side (specs/21). */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Invite, audit row (no copy of the email), then the email: specs/21 research R3, R6, R7. */
  async create(user: SessionUser, workspaceId: string, dto: CreateInviteDto) {
    const ws = await this.loadManagedWorkspace(user, workspaceId);
    const isMember = await this.prisma.workspaceMember.count({ where: { workspaceId, user: { email: dto.email } } });
    if (isMember > 0) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'This person is already a member of the workspace',
      });
    }

    const nowDate = new Date();
    // Answered or revoked rows, so revoke-then-invite cannot skip the cooldown (a pending one answers INVITE_PENDING).
    // shortcut: read-then-write, parallel requests can pass both checks once; move to auth_throttles if abused.
    const recent = await this.prisma.invite.findFirst({
      where: {
        workspaceId,
        boardId: null,
        email: dto.email,
        status: { not: 'pending' },
        lastSentAt: { gt: cooldownStart(nowDate) },
      },
      orderBy: { lastSentAt: 'desc' },
      select: { lastSentAt: true },
    });
    if (recent) throw resendCooldown(recent.lastSentAt, nowDate);
    const sentLastHour = await this.prisma.invite.count({
      where: { invitedById: user.id, createdAt: { gt: new Date(nowDate.getTime() - HOUR_MS) } },
    });
    if (sentLastHour >= INVITES_PER_HOUR) {
      throw new HttpException({ code: 'INVITE_RATE_LIMITED', message: 'Too many invites. Try again later.' }, 429);
    }

    const { DB } = getBindings();
    const id = uuidv7();
    const now = sqlDate(nowDate);
    const role = dto.role ?? 'member';
    try {
      await DB.batch([
        DB.prepare(
          `INSERT INTO invites
             (id, workspace_id, board_id, email, role, status, invited_by_id, last_sent_at, expires_at, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, ?4, 'pending', ?5, ?6, ?7, ?6, ?6)`,
        ).bind(id, workspaceId, dto.email, role, user.id, now, sqlDate(expiryFrom(nowDate))),
        DB.prepare(
          `INSERT INTO audit_log_entries
             (id, workspace_id, actor_id, actor_name, action, target_type, target_id, target_label, data, created_at, updated_at)
           SELECT ?1, ?2, u.id, u.full_name, 'invite', 'invite', ?3, '', ?4, ?5, ?5 FROM users u WHERE u.id = ?6`,
        ).bind(uuidv7(), workspaceId, id, JSON.stringify({ role }), now, user.id),
      ]);
    } catch (err) {
      // uq_invites_pending_target_nulls: one pending invite per workspace and email, expired or not.
      if (isD1UniqueConflict(err)) {
        throw new ConflictException({ code: 'INVITE_PENDING', message: 'This email already has a pending invite' });
      }
      throw err;
    }

    this.email.sendWorkspaceInvite({ id, email: dto.email }, user.fullName, ws.name);
    const row = await this.prisma.invite.findUniqueOrThrow({ where: { id }, select: inviteItemSelect });
    return toInviteItem(row, nowDate);
  }

  /** Pending workspace invites, expired included, newest first. */
  async list(user: SessionUser, workspaceId: string, { limit = DEFAULT_LIST_LIMIT, cursor }: ListInvitesDto) {
    await this.loadManagedWorkspace(user, workspaceId);
    const rows = await this.prisma.invite.findMany({
      where: { workspaceId, boardId: null, status: 'pending', ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: inviteItemSelect,
    });
    const now = new Date();
    return {
      items: rows.slice(0, limit).map((r) => toInviteItem(r, now)),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }

  /** Same row, 14 more days; the cooldown condition in the update lets only one of parallel resends send. */
  async resend(user: SessionUser, workspaceId: string, inviteId: string) {
    const ws = await this.loadManagedWorkspace(user, workspaceId);
    const nowDate = new Date();
    const target = { id: inviteId, workspaceId, boardId: null, status: 'pending' as const };
    const { count } = await this.prisma.invite.updateMany({
      where: { ...target, lastSentAt: { lte: cooldownStart(nowDate) } },
      data: { lastSentAt: nowDate, expiresAt: expiryFrom(nowDate) },
    });
    if (count === 0) {
      const row = await this.prisma.invite.findFirst({ where: target, select: { lastSentAt: true } });
      if (!row) throw inviteNotFound();
      throw resendCooldown(row.lastSentAt, nowDate);
    }

    // A revoke can land between the update and this read: then send nothing.
    const row = await this.prisma.invite.findFirst({ where: target, select: inviteItemSelect });
    if (!row) throw inviteNotFound();
    this.email.sendWorkspaceInvite({ id: inviteId, email: row.email }, user.fullName, ws.name);
    return toInviteItem(row, nowDate);
  }

  /** Accept and decline only touch pending rows, so revoke and accept cannot both win. */
  async revoke(user: SessionUser, workspaceId: string, inviteId: string) {
    await this.loadManagedWorkspace(user, workspaceId);
    const { count } = await this.prisma.invite.updateMany({
      where: { id: inviteId, workspaceId, boardId: null, status: 'pending' },
      data: { status: 'revoked' },
    });
    if (count === 0) throw inviteNotFound();
  }

  private async loadManagedWorkspace(user: SessionUser, workspaceId: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ...visibleWorkspaceWhere(user.id) },
      select: { id: true, name: true, workspaceMembers: { where: { userId: user.id }, select: { role: true } } },
    });
    if (!ws) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' });
    if (!canManageWorkspaceInvites({ workspaceRole: ws.workspaceMembers[0]?.role ?? null })) {
      throw new ForbiddenException({
        code: 'INVITE_MANAGE_FORBIDDEN',
        message: 'Only workspace admins can manage invites',
      });
    }
    return { id: ws.id, name: ws.name };
  }

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
