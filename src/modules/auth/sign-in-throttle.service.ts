import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

/**
 * Sign-in lockout on auth_throttles. The key is a hash of the lower-cased email (the table never holds the
 * email) and rows exist for unknown emails too, so lockout does not reveal which accounts exist.
 *
 * Attempts are counted BEFORE the password is checked, with one atomic increment, so parallel requests cannot
 * all slip past a check-then-count gap: at most MAX_FAILURES of them get their password verified.
 * shortcut: no cleanup of stale rows, add a periodic delete of rows with updated_at older than 30 days when the table grows.
 */
@Injectable()
export class SignInThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  private key(email: string) {
    return { scope: 'sign_in' as const, subjectKey: createHash('sha256').update(email.toLowerCase()).digest('hex') };
  }

  /** Counts this attempt. Returns false when the email is locked: the caller must not check the password. */
  async attempt(email: string, now = new Date()): Promise<boolean> {
    const key = this.key(email);
    const row = await this.prisma.authThrottle.upsert({
      where: { scope_subjectKey: key },
      create: { ...key, failedCount: 1 },
      update: { failedCount: { increment: 1 } },
    });

    if (row.lockedUntil) {
      if (row.lockedUntil > now) return false;
      // The lock ran out. Only one of several parallel requests wins this conditional update and starts over.
      const { count } = await this.prisma.authThrottle.updateMany({
        where: { id: row.id, lockedUntil: { lte: now } },
        data: { failedCount: 1, lockedUntil: null },
      });
      return count === 1;
    }
    if (row.failedCount > MAX_FAILURES) {
      await this.lock(row.id, now);
      return false;
    }
    return true;
  }

  /** After a wrong password: locks when this was the last allowed attempt. */
  async recordFailure(email: string, now = new Date()): Promise<void> {
    const row = await this.prisma.authThrottle.findUnique({ where: { scope_subjectKey: this.key(email) } });
    if (row && row.failedCount >= MAX_FAILURES && !row.lockedUntil) await this.lock(row.id, now);
  }

  /** Correct password, or the reset-password flow lifting the lock. */
  async reset(email: string): Promise<void> {
    await this.prisma.authThrottle.deleteMany({ where: this.key(email) });
  }

  private lock(id: string, now: Date) {
    return this.prisma.authThrottle.updateMany({
      where: { id, lockedUntil: null },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) },
    });
  }
}
