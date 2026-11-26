import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { throttleKey } from '../throttle-key';

/** `sign_in` is keyed by the lower-cased email, `change_password` by the user id. */
export type AttemptScope = 'sign_in' | 'change_password';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

/**
 * Lockout on auth_throttles for sign-in and for the current-password check of change password (specs/22 D7).
 * Each scope has its own rows, so a change-password lock never blocks sign-in.
 *
 * Sign-in: the key is a hash of the lower-cased email (the table never holds the email) and rows exist for unknown
 * emails too, so lockout does not reveal which accounts exist.
 *
 * Attempts are counted BEFORE the password is checked, with one atomic increment, so parallel requests cannot
 * all slip past a check-then-count gap: at most MAX_FAILURES of them get their password verified.
 * shortcut: no cleanup of stale rows, add a periodic delete of rows with updated_at older than 30 days when the table grows.
 */
@Injectable()
export class SignInThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts this attempt. Returns false when the subject is locked: the caller must not check the password. */
  async attempt(subject: string, scope: AttemptScope = 'sign_in', now = new Date()): Promise<boolean> {
    const key = throttleKey(scope, subject);
    // Failures older than LOCK_MINUTES since the last attempt no longer count ("5 within 15 minutes"). Without
    // this, change-password failures (rarely reset) would add up for months. Conditional, so safe in parallel.
    await this.prisma.authThrottle.updateMany({
      where: { ...key, lockedUntil: null, updatedAt: { lt: new Date(now.getTime() - LOCK_MINUTES * 60_000) } },
      data: { failedCount: 0 },
    });
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
  async recordFailure(subject: string, scope: AttemptScope = 'sign_in', now = new Date()): Promise<void> {
    const row = await this.prisma.authThrottle.findUnique({ where: { scope_subjectKey: throttleKey(scope, subject) } });
    if (row && row.failedCount >= MAX_FAILURES && !row.lockedUntil) await this.lock(row.id, now);
  }

  /** Correct password, or the reset-password flow lifting the lock. */
  async reset(subject: string, scope: AttemptScope = 'sign_in'): Promise<void> {
    await this.prisma.authThrottle.deleteMany({ where: throttleKey(scope, subject) });
  }

  private lock(id: string, now: Date) {
    return this.prisma.authThrottle.updateMany({
      where: { id, lockedUntil: null },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) },
    });
  }
}
