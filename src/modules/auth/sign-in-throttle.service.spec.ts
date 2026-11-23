import type { PrismaService } from '../../database/prisma.service';
import { LOCK_MINUTES, MAX_FAILURES, SignInThrottleService } from './sign-in-throttle.service';

interface Row {
  id: string;
  subjectKey: string;
  failedCount: number;
  lockedUntil: Date | null;
}
type Where = { id?: string; lockedUntil?: null | { lte: Date }; subjectKey?: string };

/** In-memory stand-in for the few auth_throttles calls the service makes. Each call is atomic, like one SQL statement. */
function fakePrisma() {
  const rows = new Map<string, Row>();
  const byId = (id: string) => [...rows.values()].find((r) => r.id === id);
  const authThrottle = {
    findUnique: ({ where }: { where: { scope_subjectKey: { subjectKey: string } } }) =>
      Promise.resolve(rows.get(where.scope_subjectKey.subjectKey) ?? null),
    upsert: ({
      where,
      create,
    }: {
      where: { scope_subjectKey: { subjectKey: string } };
      create: { failedCount: number };
    }) => {
      const key = where.scope_subjectKey.subjectKey;
      const row = rows.get(key);
      if (row) row.failedCount += 1;
      else rows.set(key, { id: key, subjectKey: key, failedCount: create.failedCount, lockedUntil: null });
      return Promise.resolve({ ...rows.get(key)! });
    },
    updateMany: ({ where, data }: { where: Where; data: Partial<Row> }) => {
      const row = where.id ? byId(where.id) : undefined;
      const lock = where.lockedUntil;
      const matches =
        !!row && (lock === null ? row.lockedUntil === null : !!row.lockedUntil && row.lockedUntil <= lock!.lte);
      if (matches) Object.assign(row, data);
      return Promise.resolve({ count: matches ? 1 : 0 });
    },
    deleteMany: ({ where }: { where: Where }) => {
      rows.delete(where.subjectKey!);
      return Promise.resolve({ count: 1 });
    },
  };
  return { prisma: { authThrottle } as unknown as PrismaService, rows };
}

describe('SignInThrottleService', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const email = 'a@e2e.test';
  let service: SignInThrottleService;

  beforeEach(() => {
    service = new SignInThrottleService(fakePrisma().prisma);
  });

  /** One wrong sign-in: counted first, then recorded as a failure when it was allowed. */
  const wrongAttempt = async (at = now, who = email) => {
    const allowed = await service.attempt(who, at);
    if (allowed) await service.recordFailure(who, at);
    return allowed;
  };

  it('allows 5 wrong attempts, then refuses the 6th without counting it as an attempt to verify', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect(await wrongAttempt()).toBe(true);
    expect(await wrongAttempt()).toBe(false);
  });

  it('stays locked for 15 minutes, then lets one attempt through and starts counting again', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt();
    expect(await service.attempt(email, later(LOCK_MINUTES - 1))).toBe(false);
    expect(await wrongAttempt(later(LOCK_MINUTES))).toBe(true);
    // That was attempt 1 of a new window, so 4 more are allowed.
    for (let i = 0; i < MAX_FAILURES - 1; i++) expect(await wrongAttempt(later(LOCK_MINUTES))).toBe(true);
    expect(await wrongAttempt(later(LOCK_MINUTES))).toBe(false);
  });

  it('lets only MAX_FAILURES of many parallel attempts through', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => service.attempt(email, now)));
    expect(results.filter(Boolean)).toHaveLength(MAX_FAILURES);
  });

  it('lets exactly one parallel attempt through when a lock has just run out', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt();
    const results = await Promise.all(Array.from({ length: 10 }, () => service.attempt(email, later(LOCK_MINUTES))));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('reset clears the count and the lock', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt();
    await service.reset(email);
    expect(await service.attempt(email, now)).toBe(true);
  });

  it('uses the same key for any letter case of an email', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt(now, 'A@E2E.test');
    expect(await service.attempt('a@e2e.TEST', now)).toBe(false);
  });
});
