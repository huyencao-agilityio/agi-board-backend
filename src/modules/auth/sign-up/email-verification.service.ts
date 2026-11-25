import { Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { isUniqueConflict } from '../../../database/prisma-errors';
import { PrismaService } from '../../../database/prisma.service';
import { EmailService, type EmailRecipient } from '../../email/email.service';
import { throttleKey } from '../throttle-key';

export const MAX_CODE_ATTEMPTS = 5;
export const CODE_MINUTES = 10;
export const RESEND_SECONDS = 60;

const codeHash = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');
const cooldownStart = (now: Date) => new Date(now.getTime() - RESEND_SECONDS * 1000);
const codeWindowStart = (now: Date) => new Date(now.getTime() - CODE_MINUTES * 60_000);

/**
 * Email verification codes. Attempts, expiry and cooldown are kept per email on auth_throttles, for emails with and
 * without a real code alike, so the limits do not reveal which accounts exist (specs/5/research.md R3). The key is a
 * hash of the lower-cased email.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private key(email: string) {
    return throttleKey('verify_email', email);
  }

  /**
   * Opens a new window unless one began within the cooldown: the same rule for sign-up, resend and sign-in, and for
   * every email. Only one of several parallel calls wins.
   * shortcut: no cleanup of stale rows, add a periodic delete of rows with updated_at older than 30 days when the table grows.
   */
  async claim(email: string, now = new Date()): Promise<boolean> {
    if (await this.restart(email, now)) return true;
    // Usual refusal; the conflict below is only for a parallel request (the D1 adapter logs every conflict as an error).
    if (await this.findRow(email)) return false;
    try {
      await this.prisma.authThrottle.create({ data: { ...this.key(email), lastSentAt: now }, select: { id: true } });
      return true;
    } catch (err) {
      if (isUniqueConflict(err)) return false;
      throw err;
    }
  }

  /** Counts this attempt before the code is compared, with one atomic update, so parallel guesses cannot exceed the limit. */
  async attempt(email: string, now = new Date()): Promise<'ok' | 'expired' | 'locked'> {
    const { count } = await this.prisma.authThrottle.updateMany({
      where: { ...this.key(email), failedCount: { lt: MAX_CODE_ATTEMPTS }, lastSentAt: { gt: codeWindowStart(now) } },
      data: { failedCount: { increment: 1 } },
    });
    if (count === 1) return 'ok';
    const row = await this.findRow(email);
    return row?.lastSentAt && row.lastSentAt > codeWindowStart(now) ? 'locked' : 'expired';
  }

  private async voidLiveCode(userId: string, now = new Date()): Promise<void> {
    await this.prisma.emailVerificationCode.updateMany({
      where: { userId, consumedAt: null, voidedAt: null },
      data: { voidedAt: now },
    });
  }

  /** Replaces the live code. Null when a parallel request issued one first. */
  async issueCode(userId: string, now = new Date()): Promise<string | null> {
    const code = randomInt(1_000_000).toString().padStart(6, '0');
    await this.voidLiveCode(userId, now);
    try {
      await this.prisma.emailVerificationCode.create({
        data: {
          userId,
          codeHash: codeHash(userId, code),
          expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
        },
        select: { id: true },
      });
      return code;
    } catch (err) {
      if (isUniqueConflict(err)) return null;
      throw err;
    }
  }

  /** Issues a code and emails it; nothing when a parallel request issued one first. */
  async sendCode(user: EmailRecipient): Promise<void> {
    const code = await this.issueCode(user.id);
    if (code) this.email.sendVerificationCode(user, code);
  }

  /** Uses up the live code. True for exactly one caller with the right code. */
  async consume(userId: string, code: string, now = new Date()): Promise<boolean> {
    const live = await this.prisma.emailVerificationCode.findFirst({
      where: { userId, consumedAt: null, voidedAt: null, expiresAt: { gt: now } },
      select: { id: true, codeHash: true },
    });
    if (!live) return false;
    const expected = Buffer.from(live.codeHash);
    const actual = Buffer.from(codeHash(userId, code));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const { count } = await this.prisma.emailVerificationCode.updateMany({
      where: { id: live.id, consumedAt: null, voidedAt: null },
      data: { consumedAt: now },
    });
    return count === 1;
  }

  private async restart(email: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.authThrottle.updateMany({
      where: { ...this.key(email), lastSentAt: { lte: cooldownStart(now) } },
      data: { failedCount: 0, lastSentAt: now },
    });
    return count === 1;
  }

  private findRow(email: string) {
    return this.prisma.authThrottle.findUnique({
      where: { scope_subjectKey: this.key(email) },
      select: { lastSentAt: true },
    });
  }
}
