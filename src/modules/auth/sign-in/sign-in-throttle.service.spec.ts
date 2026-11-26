import type { PrismaService } from '../../../database/prisma.service';
import { LOCK_MINUTES, MAX_FAILURES, SignInThrottleService } from './sign-in-throttle.service';

interface Row {
  id: string;
  subjectKey: string;
  failedCount: number;
  lockedUntil: Date | null;
  updatedAt: Date;
}
type Where = {
  id?: string;
  lockedUntil?: null | { lte: Date };
  scope?: string;
  subjectKey?: string;
  updatedAt?: { lt: Date };
};
type Key = { scope: string; subjectKey: string };
const rowKey = (k: Key) => `${k.scope}:${k.subjectKey}`;

/**
 * In-memory stand-in for the few auth_throttles calls the service makes. Each call is atomic, like one SQL statement.
 * Rows get `updatedAt = TEST_NOW` (Prisma's @updatedAt uses the real clock); tests age a row by editing it.
 */
const TEST_NOW = new Date('2026-11-23T10:00:00Z');
function fakePrisma() {
  const rows = new Map<string, Row>();
  const byId = (id: string) => [...rows.values()].find((r) => r.id === id);
  const authThrottle = {
    findUnique: ({ where }: { where: { scope_subjectKey: Key } }) =>
      Promise.resolve(rows.get(rowKey(where.scope_subjectKey)) ?? null),
    upsert: ({ where, create }: { where: { scope_subjectKey: Key }; create: { failedCount: number } }) => {
      const key = rowKey(where.scope_subjectKey);
      const row = rows.get(key);
      if (row) Object.assign(row, { failedCount: row.failedCount + 1, updatedAt: TEST_NOW });
      else
        rows.set(key, {
          id: key,
          subjectKey: key,
          failedCount: create.failedCount,
          lockedUntil: null,
          updatedAt: TEST_NOW,
        });
      return Promise.resolve({ ...rows.get(key)! });
    },
    updateMany: ({ where, data }: { where: Where; data: Partial<Row> }) => {
      const row = where.id ? byId(where.id) : where.subjectKey ? rows.get(rowKey(where as Key)) : undefined;
      const lock = where.lockedUntil;
      const matches =
        !!row &&
        (lock === null ? row.lockedUntil === null : !!row.lockedUntil && row.lockedUntil <= lock!.lte) &&
        (!where.updatedAt || row.updatedAt < where.updatedAt.lt);
      if (matches) Object.assign(row, data);
      return Promise.resolve({ count: matches ? 1 : 0 });
    },
    deleteMany: ({ where }: { where: Where }) => {
      rows.delete(rowKey(where as Key));
      return Promise.resolve({ count: 1 });
    },
  };
  return { prisma: { authThrottle } as unknown as PrismaService, rows };
}

describe('SignInThrottleService', () => {
  const now = TEST_NOW;
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const email = 'a@e2e.test';
  let service: SignInThrottleService;
  let rows: Map<string, Row>;

  beforeEach(() => {
    const fake = fakePrisma();
    rows = fake.rows;
    service = new SignInThrottleService(fake.prisma);
  });

  /** One wrong sign-in: counted first, then recorded as a failure when it was allowed. */
  const wrongAttempt = async (at = now, who = email) => {
    const allowed = await service.attempt(who, 'sign_in', at);
    if (allowed) await service.recordFailure(who, 'sign_in', at);
    return allowed;
  };

  it('allows 5 wrong attempts, then refuses the 6th without counting it as an attempt to verify', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect(await wrongAttempt()).toBe(true);
    expect(await wrongAttempt()).toBe(false);
  });

  it('stays locked for 15 minutes, then lets one attempt through and starts counting again', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt();
    expect(await service.attempt(email, 'sign_in', later(LOCK_MINUTES - 1))).toBe(false);
    expect(await wrongAttempt(later(LOCK_MINUTES))).toBe(true);
    // That was attempt 1 of a new window, so 4 more are allowed.
    for (let i = 0; i < MAX_FAILURES - 1; i++) expect(await wrongAttempt(later(LOCK_MINUTES))).toBe(true);
    expect(await wrongAttempt(later(LOCK_MINUTES))).toBe(false);
  });

  it('lets only MAX_FAILURES of many parallel attempts through', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => service.attempt(email, 'sign_in', now)));
    expect(results.filter(Boolean)).toHaveLength(MAX_FAILURES);
  });

  it('lets exactly one parallel attempt through when a lock has just run out', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.attempt(email, 'sign_in', later(LOCK_MINUTES))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('reset clears the count and the lock', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt();
    await service.reset(email);
    expect(await service.attempt(email, 'sign_in', now)).toBe(true);
  });

  it('keeps change_password apart from sign_in for the same subject', async () => {
    const userId = '0193a000-0000-7000-8000-000000000001';
    for (let i = 0; i < MAX_FAILURES; i++) {
      if (await service.attempt(userId, 'change_password', now))
        await service.recordFailure(userId, 'change_password', now);
    }
    expect(await service.attempt(userId, 'change_password', now)).toBe(false);
    expect(await service.attempt(userId, 'sign_in', now)).toBe(true);
    await service.reset(userId, 'change_password');
    expect(await service.attempt(userId, 'change_password', now)).toBe(true);
  });

  it('forgets failures older than LOCK_MINUTES since the last attempt', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await wrongAttempt();
    for (const row of rows.values()) row.updatedAt = later(-LOCK_MINUTES - 1);
    // Four old failures no longer count: five more are allowed before the lock.
    for (let i = 0; i < MAX_FAILURES; i++) expect(await wrongAttempt()).toBe(true);
    expect(await wrongAttempt()).toBe(false);
  });

  it('uses the same key for any letter case of an email', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await wrongAttempt(now, 'A@E2E.test');
    expect(await service.attempt('a@e2e.TEST', 'sign_in', now)).toBe(false);
  });
});
