import type { PrismaService } from '../../database/prisma.service';
import { LOCK_MINUTES, MAX_FAILURES, SignInThrottleService } from './sign-in-throttle.service';

interface Row {
  id: string;
  scope: string;
  subjectKey: string;
  failedCount: number;
  lockedUntil: Date | null;
}

/** In-memory stand-in for the few auth_throttles calls the service makes. */
function fakePrisma() {
  const rows = new Map<string, Row>();
  const at = (key: { subjectKey: string }) => rows.get(key.subjectKey);
  const authThrottle = {
    findUnique: ({ where }: { where: { scope_subjectKey: { subjectKey: string } } }) =>
      Promise.resolve(at(where.scope_subjectKey) ?? null),
    upsert: ({ where, create }: { where: { scope_subjectKey: { subjectKey: string } }; create: Row }) => {
      const row = at(where.scope_subjectKey);
      if (row) row.failedCount += 1;
      else rows.set(where.scope_subjectKey.subjectKey, { ...create, id: create.subjectKey, lockedUntil: null });
      return Promise.resolve(at(where.scope_subjectKey));
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      Object.assign(rows.get(where.id)!, data);
      return Promise.resolve(rows.get(where.id));
    },
    deleteMany: ({ where }: { where: { subjectKey: string } }) => {
      rows.delete(where.subjectKey);
      return Promise.resolve({ count: 1 });
    },
  };
  return { prisma: { authThrottle } as unknown as PrismaService, rows };
}

describe('SignInThrottleService', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  let service: SignInThrottleService;

  beforeEach(() => {
    service = new SignInThrottleService(fakePrisma().prisma);
  });

  const fail = async (times: number, email = 'a@e2e.test') => {
    for (let i = 0; i < times; i++) await service.recordFailure(email, now);
  };

  it('does not lock before the 5th failure', async () => {
    await fail(MAX_FAILURES - 1);
    expect(await service.isLocked('a@e2e.test', now)).toBe(false);
  });

  it('locks on the 5th failure for 15 minutes, then unlocks', async () => {
    await fail(MAX_FAILURES);
    expect(await service.isLocked('a@e2e.test', later(LOCK_MINUTES - 1))).toBe(true);
    expect(await service.isLocked('a@e2e.test', later(LOCK_MINUTES))).toBe(false);
  });

  it('starts counting again from 1 after a lock ran out', async () => {
    await fail(MAX_FAILURES);
    await service.isLocked('a@e2e.test', later(LOCK_MINUTES));
    await fail(MAX_FAILURES - 1);
    expect(await service.isLocked('a@e2e.test', now)).toBe(false);
  });

  it('keeps the count at the limit when more failures arrive', async () => {
    const { prisma, rows } = fakePrisma();
    service = new SignInThrottleService(prisma);
    await fail(MAX_FAILURES + 2);
    expect([...rows.values()][0].failedCount).toBe(MAX_FAILURES);
  });

  it('reset lifts the lock', async () => {
    await fail(MAX_FAILURES);
    await service.reset('a@e2e.test');
    expect(await service.isLocked('a@e2e.test', now)).toBe(false);
  });

  it('uses the same key for any letter case of an email', async () => {
    await fail(MAX_FAILURES, 'A@E2E.test');
    expect(await service.isLocked('a@e2e.TEST', now)).toBe(true);
  });
});
