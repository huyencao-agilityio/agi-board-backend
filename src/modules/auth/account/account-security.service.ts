import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getBindings } from '../../../cloudflare';
import { auditStatement, sqlDate } from '../../../common/audit-log';
import type { SessionUser } from '../../../common/guards/session.guard';
import { DAY_MS } from '../../../common/session-cookie';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../database/prisma.service';
import { passwordUserSelect } from '../auth-user.select';
import type { ChangePasswordDto } from '../dto/change-password.dto';
import { failedPasswordRules } from '../password/password-rules';
import { PasswordService } from '../password/password.service';
import { SignInThrottleService } from '../sign-in/sign-in-throttle.service';

export interface ActiveSession {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  isCurrent: boolean;
}

/** 400, not 401: the caller is still signed in, the frontend must not treat it as "signed out". */
const currentPasswordIncorrect = () =>
  new BadRequestException({ code: 'CURRENT_PASSWORD_INCORRECT', message: 'The current password is not correct.' });

/** One more entry in the new-password rule list, only for change password (the others are in password-rules.ts). */
export const SAME_AS_CURRENT = 'password must differ from the current password';

/** Password change and active sessions of the signed-in user (specs/22 research D6–D8). */
@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: SignInThrottleService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Replaces the password and ends every other live session; the current one stays signed in. A wrong current
   * password is answered before the new-password rules, so the rules never confirm a guess.
   */
  async changePassword(user: SessionUser, dto: ChangePasswordDto): Promise<void> {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: passwordUserSelect });
    if (!account.passwordHash) {
      throw new BadRequestException({ code: 'PASSWORD_NOT_SET', message: 'This account signs in with Google only.' });
    }
    // Counted first (atomic), so parallel guesses cannot all be verified. Keyed by user id, apart from sign-in.
    if (!(await this.throttle.attempt(user.id, 'change_password'))) {
      throw new HttpException(
        { code: 'CHANGE_PASSWORD_LOCKED', message: 'Too many attempts. Try again in 15 minutes.' },
        429,
      );
    }
    if (!(await this.passwords.verify(dto.currentPassword, account.passwordHash))) {
      await this.throttle.recordFailure(user.id, 'change_password');
      throw currentPasswordIncorrect();
    }
    // The right password is not a failure (as in sign-in): weak new passwords must not lock the owner out.
    await this.throttle.reset(user.id, 'change_password');
    const failed = failedPasswordRules(dto.newPassword, account.email);
    // The current password was just verified, so plain equality means "unchanged" without another hash (PO, 2026-11-26).
    if (dto.newPassword === dto.currentPassword) failed.push(SAME_AS_CURRENT);
    if (failed.length > 0) throw new BadRequestException(failed);

    const newHash = await this.passwords.hash(dto.newPassword);
    const { DB } = getBindings();
    const now = sqlDate(new Date());
    // All or nothing (Prisma's $transaction is not atomic on D1). The password update only applies if the hash
    // is still the one just verified; the other statements only run once the new hash is in place.
    const newHashInPlace = 'EXISTS (SELECT 1 FROM users WHERE id = ?3 AND password_hash = ?1)';
    const [updated] = await DB.batch([
      DB.prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3 AND password_hash = ?4').bind(
        newHash,
        now,
        user.id,
        account.passwordHash,
      ),
      DB.prepare(
        `UPDATE user_sessions SET ended_at = ?2, end_reason = 'password_changed', updated_at = ?2
         WHERE user_id = ?3 AND id <> ?4 AND ended_at IS NULL AND ${newHashInPlace}`,
      ).bind(newHash, now, user.id, user.sessionId),
      // A reset link issued before the change would otherwise still replace the new password.
      DB.prepare(
        `UPDATE password_reset_tokens SET voided_at = ?2, updated_at = ?2
         WHERE user_id = ?3 AND used_at IS NULL AND voided_at IS NULL AND ${newHashInPlace}`,
      ).bind(newHash, now, user.id),
      auditStatement(DB, { action: 'password_changed', userId: user.id, now }, newHashInPlace, [newHash, now, user.id]),
    ]);
    // The password was replaced meanwhile (a reset or another change): the verified one is no longer current.
    if (updated.meta.changes !== 1) throw currentPasswordIncorrect();
  }

  /** Not ended and used within SESSION_IDLE_DAYS: an idle one not yet marked expired is not live. */
  private liveSince(now: Date) {
    return new Date(now.getTime() - this.config.get('SESSION_IDLE_DAYS', { infer: true }) * DAY_MS);
  }

  /** Live sessions, newest activity first. Not paginated on purpose: a user has a handful (research D8). */
  async listSessions(user: SessionUser, now = new Date()): Promise<{ items: ActiveSession[] }> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId: user.id, endedAt: null, lastActiveAt: { gt: this.liveSince(now) } },
      orderBy: { lastActiveAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, lastActiveAt: true },
    });
    return { items: sessions.map((s) => ({ ...s, isCurrent: s.id === user.sessionId })) };
  }

  /** Ends one of the user's other live sessions. Someone else's, unknown or ended: 404, so nothing is revealed. */
  async endSession(user: SessionUser, sessionId: string): Promise<void> {
    if (sessionId === user.sessionId) {
      throw new BadRequestException({ code: 'CURRENT_SESSION', message: 'Use log out to end this session.' });
    }
    const { DB } = getBindings();
    const at = new Date();
    const now = sqlDate(at);
    // The audit row is written only if the update ended the session (same batch, so atomic). It must stay directly
    // after the update: changes() reads the previous statement.
    const [ended] = await DB.batch([
      DB.prepare(
        `UPDATE user_sessions SET ended_at = ?1, end_reason = 'signed_out_by_user', updated_at = ?1
         WHERE id = ?2 AND user_id = ?3 AND ended_at IS NULL AND last_active_at > ?4`,
      ).bind(now, sessionId, user.id, sqlDate(this.liveSince(at))),
      auditStatement(
        DB,
        { action: 'session_signed_out', userId: user.id, now, data: { sessionId } },
        'changes() > 0',
        [],
      ),
    ]);
    if (ended.meta.changes === 0) {
      throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }
  }

  async endOtherSessions(user: SessionUser): Promise<void> {
    const { DB } = getBindings();
    const now = sqlDate(new Date());
    // As in endSession: the audit row must stay directly after the update (changes() reads the previous statement).
    await DB.batch([
      DB.prepare(
        `UPDATE user_sessions SET ended_at = ?1, end_reason = 'signed_out_by_user', updated_at = ?1
         WHERE user_id = ?2 AND ended_at IS NULL AND id <> ?3`,
      ).bind(now, user.id, user.sessionId),
      auditStatement(DB, { action: 'other_sessions_signed_out', userId: user.id, now }, 'changes() > 0', []),
    ]);
  }
}
