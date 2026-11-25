import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getBindings, runInBackground } from '../../../cloudflare';
import { hashSessionToken, newSessionToken } from '../../../common/session-token';
import { isUniqueConflict } from '../../../database/prisma-errors';
import { PrismaService } from '../../../database/prisma.service';
import { EmailService, type EmailRecipient } from '../../email/email.service';
import type { CheckResetLinkDto } from '../dto/check-reset-link.dto';
import type { ForgotPasswordDto } from '../dto/forgot-password.dto';
import type { ResetPasswordDto } from '../dto/reset-password.dto';
import { failedPasswordRules } from '../password/password-rules';
import { PasswordService } from '../password/password.service';
import { SendCooldownService } from '../send-cooldown.service';
import { throttleKey } from '../throttle-key';

export const LINK_MINUTES = 30;

/** One error for every unusable link, so it does not reveal why (decisions #45, #46). */
const linkInvalid = () =>
  new BadRequestException({
    code: 'RESET_LINK_INVALID',
    message: 'This link has expired or was already used.',
  });

/** Raw SQL bypasses Prisma, which stores dates in this form. */
const sqlDate = (date: Date) => date.toISOString().replace('Z', '+00:00');

/** Parameters: ?1 the link id, ?2 now. */
const LINK_IS_VALID = `EXISTS (
  SELECT 1 FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
  WHERE t.id = ?1 AND t.used_at IS NULL AND t.voided_at IS NULL AND t.expires_at > ?2
    AND u.deactivated_at IS NULL AND u.password_hash IS NOT NULL)`;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly cooldown: SendCooldownService,
    private readonly email: EmailService,
  ) {}

  /** Always the same answer. Within the cooldown nothing is sent and the earlier link stays valid. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    if (await this.cooldown.claim('reset_email', dto.email)) {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true, email: true, passwordHash: true, deactivatedAt: true },
      });
      if (user) this.sendInBackground(user, !!user.passwordHash);
    }
    return { sent: true };
  }

  async checkLink(dto: CheckResetLinkDto): Promise<{ email: string }> {
    const { user } = await this.findValidLink(dto.token);
    return { email: user.email };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ next: 'sign-in' }> {
    const { id, user } = await this.findValidLink(dto.token);
    const failed = failedPasswordRules(dto.password, user.email);
    if (failed.length > 0) throw new BadRequestException(failed);
    await this.applyReset(id, user, await this.passwords.hash(dto.password));
    return { next: 'sign-in' };
  }

  /** After the response: the extra writes would reveal through timing which emails have an account. */
  private sendInBackground(user: EmailRecipient, hasPassword: boolean) {
    const task = async () => {
      try {
        if (hasPassword) await this.sendLink(user);
        else this.email.sendGoogleSignInNotice(user);
      } catch (err) {
        // Database errors can quote the query parameters, so only the error class is logged.
        this.logger.warn(`Reset link for ${user.email} failed: ${err instanceof Error ? err.name : 'unknown error'}`);
      }
    };
    try {
      runInBackground(task());
    } catch (err) {
      // A failing runner must not turn only the requests that send email into a 500.
      this.logger.warn(
        `Reset link for user ${user.id} not scheduled: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    }
  }

  /** Replaces the live link and emails the new one; nothing when a parallel request issued one first. */
  private async sendLink(user: EmailRecipient, now = new Date()): Promise<void> {
    const token = newSessionToken();
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, voidedAt: null },
      data: { voidedAt: now },
    });
    try {
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(now.getTime() + LINK_MINUTES * 60_000),
        },
        select: { id: true },
      });
    } catch (err) {
      if (isUniqueConflict(err)) return;
      throw err;
    }
    this.email.sendResetLink({ id: user.id, email: user.email }, token);
  }

  private async findValidLink(token: string): Promise<{ id: string; user: EmailRecipient }> {
    const link = await this.prisma.passwordResetToken.findUnique({
      where: {
        tokenHash: hashSessionToken(token),
        usedAt: null,
        voidedAt: null,
        user: { deactivatedAt: null, passwordHash: { not: null } },
      },
      select: { id: true, user: { select: { id: true, email: true } } },
    });
    if (!link) throw linkInvalid();
    return link;
  }

  /** All or nothing, for exactly one caller per link. */
  private async applyReset(linkId: string, user: EmailRecipient, passwordHash: string): Promise<void> {
    const { DB } = getBindings();
    const now = sqlDate(new Date());
    const lock = throttleKey('sign_in', user.email);
    // The link is marked used last, so every statement before it still sees a valid link.
    const results = await DB.batch([
      DB.prepare(`UPDATE users SET password_hash = ?3, updated_at = ?2 WHERE id = ?4 AND ${LINK_IS_VALID}`).bind(
        linkId,
        now,
        passwordHash,
        user.id,
      ),
      DB.prepare(
        `UPDATE user_sessions SET ended_at = ?2, end_reason = 'password_reset', updated_at = ?2
         WHERE user_id = ?3 AND ended_at IS NULL AND ${LINK_IS_VALID}`,
      ).bind(linkId, now, user.id),
      DB.prepare(`DELETE FROM auth_throttles WHERE scope = ?3 AND subject_key = ?4 AND ${LINK_IS_VALID}`).bind(
        linkId,
        now,
        lock.scope,
        lock.subjectKey,
      ),
      DB.prepare(
        `UPDATE password_reset_tokens SET used_at = ?2, updated_at = ?2 WHERE id = ?1 AND ${LINK_IS_VALID}`,
      ).bind(linkId, now),
    ]);
    if (results[results.length - 1].meta.changes !== 1) throw linkInvalid();
  }
}
