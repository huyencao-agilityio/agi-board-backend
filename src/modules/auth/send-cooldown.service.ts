import { Injectable } from '@nestjs/common';
import { isUniqueConflict } from '../../database/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { AuthThrottleScope } from '../../generated/prisma/enums';
import { throttleKey } from './throttle-key';

export const RESEND_SECONDS = 60;

const cooldownStart = (now: Date) => new Date(now.getTime() - RESEND_SECONDS * 1000);

/** Limits how often an email is sent, per scope and address, for addresses with and without an account alike. */
@Injectable()
export class SendCooldownService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens a new window unless one began within the cooldown: the same rule for every flow of a scope, and for
   * every email. Only one of several parallel calls wins.
   * shortcut: no cleanup of stale rows, add a periodic delete of rows with updated_at older than 30 days when the table grows.
   */
  async claim(scope: AuthThrottleScope, email: string, now = new Date()): Promise<boolean> {
    const key = throttleKey(scope, email);
    const { count } = await this.prisma.authThrottle.updateMany({
      where: { ...key, lastSentAt: { lte: cooldownStart(now) } },
      data: { failedCount: 0, lastSentAt: now },
    });
    if (count === 1) return true;
    // Usual refusal; the conflict below is only for a parallel request (the D1 adapter logs every conflict as an error).
    if (await this.prisma.authThrottle.findUnique({ where: { scope_subjectKey: key }, select: { id: true } })) {
      return false;
    }
    try {
      await this.prisma.authThrottle.create({ data: { ...key, lastSentAt: now }, select: { id: true } });
      return true;
    } catch (err) {
      if (isUniqueConflict(err)) return false;
      throw err;
    }
  }
}
