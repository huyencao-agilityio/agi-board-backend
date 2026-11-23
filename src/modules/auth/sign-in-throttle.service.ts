import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

/**
 * Sign-in lockout on auth_throttles. The key is a hash of the lower-cased email (the table never holds the
 * email) and rows exist for unknown emails too, so lockout does not reveal which accounts exist.
 * shortcut: no cleanup of stale rows, add a periodic delete of rows with updated_at older than 30 days when the table grows.
 */
@Injectable()
export class SignInThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  private key(email: string) {
    return { scope: 'sign_in' as const, subjectKey: createHash('sha256').update(email.toLowerCase()).digest('hex') };
  }

  async isLocked(email: string, now = new Date()): Promise<boolean> {
    const row = await this.prisma.authThrottle.findUnique({ where: { scope_subjectKey: this.key(email) } });
    if (!row?.lockedUntil) return false;
    if (row.lockedUntil > now) return true;
    // The lock ran out: the next failure starts again at 1.
    await this.reset(email);
    return false;
  }

  async recordFailure(email: string, now = new Date()): Promise<void> {
    const key = this.key(email);
    // One atomic UPDATE ... SET failed_count = failed_count + 1, so parallel attempts cannot lose a count.
    const row = await this.prisma.authThrottle.upsert({
      where: { scope_subjectKey: key },
      create: { ...key, failedCount: 1 },
      update: { failedCount: { increment: 1 } },
    });
    if (row.failedCount >= MAX_FAILURES) {
      await this.prisma.authThrottle.update({
        where: { id: row.id },
        data: {
          failedCount: MAX_FAILURES,
          lockedUntil: row.lockedUntil ?? new Date(now.getTime() + LOCK_MINUTES * 60_000),
        },
      });
    }
  }

  /** Successful sign-in, or the reset-password flow lifting the lock. */
  async reset(email: string): Promise<void> {
    await this.prisma.authThrottle.deleteMany({ where: this.key(email) });
  }
}
