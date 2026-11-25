import type { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { EmailService } from '../../email/email.service';
import { SendCooldownService } from '../send-cooldown.service';
import { EmailVerificationService } from './email-verification.service';

const conflict = () => new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2002', clientVersion: 'test' });

interface Row {
  subjectKey: string;
  failedCount: number;
  lastSentAt: Date;
}
interface Where {
  subjectKey: string;
  failedCount?: { lt: number };
  lastSentAt?: { lte?: Date; gt?: Date };
}
interface Code {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  voidedAt: Date | null;
}

/** In-memory stand-in for the calls the service makes. Each call is atomic, like one SQL statement. */
function fakePrisma() {
  const rows = new Map<string, Row>();
  const codes: Code[] = [];
  const authThrottle = {
    findUnique: ({ where }: { where: { scope_subjectKey: { subjectKey: string } } }) =>
      Promise.resolve(rows.get(where.scope_subjectKey.subjectKey) ?? null),
    create: ({ data }: { data: { subjectKey: string; lastSentAt: Date } }) => {
      if (rows.has(data.subjectKey)) return Promise.reject(conflict());
      rows.set(data.subjectKey, { failedCount: 0, ...data });
      return Promise.resolve({});
    },
    updateMany: ({ where, data }: { where: Where; data: { failedCount: number | object; lastSentAt?: Date } }) => {
      const row = rows.get(where.subjectKey);
      const ok =
        !!row &&
        (!where.failedCount || row.failedCount < where.failedCount.lt) &&
        (!where.lastSentAt?.lte || row.lastSentAt <= where.lastSentAt.lte) &&
        (!where.lastSentAt?.gt || row.lastSentAt > where.lastSentAt.gt);
      if (ok) {
        row.failedCount = typeof data.failedCount === 'number' ? data.failedCount : row.failedCount + 1;
        if (data.lastSentAt) row.lastSentAt = data.lastSentAt;
      }
      return Promise.resolve({ count: ok ? 1 : 0 });
    },
  };
  const isLive = (c: Code) => !c.consumedAt && !c.voidedAt;
  const emailVerificationCode = {
    create: ({ data }: { data: Pick<Code, 'userId' | 'codeHash' | 'expiresAt'> }) => {
      if (codes.some((c) => c.userId === data.userId && isLive(c))) return Promise.reject(conflict());
      codes.push({ id: String(codes.length), consumedAt: null, voidedAt: null, ...data });
      return Promise.resolve({});
    },
    findFirst: ({ where }: { where: { userId: string; expiresAt: { gt: Date } } }) =>
      Promise.resolve(
        codes.find((c) => c.userId === where.userId && isLive(c) && c.expiresAt > where.expiresAt.gt) ?? null,
      ),
    updateMany: ({ where, data }: { where: { id?: string; userId?: string }; data: Partial<Code> }) => {
      const hit = codes.filter((c) => isLive(c) && (where.id ? c.id === where.id : c.userId === where.userId));
      hit.forEach((c) => Object.assign(c, data));
      return Promise.resolve({ count: hit.length });
    },
  };
  return { prisma: { authThrottle, emailVerificationCode } as unknown as PrismaService, codes };
}

describe('EmailVerificationService', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const after = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  const email = 'a@e2e.test';
  const sendVerificationCode = jest.fn();
  let service: EmailVerificationService;
  let codes: Code[];

  beforeEach(() => {
    sendVerificationCode.mockClear();
    const fake = fakePrisma();
    ({ codes } = fake);
    service = new EmailVerificationService(
      fake.prisma,
      { sendVerificationCode } as unknown as EmailService,
      new SendCooldownService(fake.prisma),
    );
  });

  const useUpAttempts = async (at = now) => {
    for (let i = 0; i < 5; i++) expect(await service.attempt(email, at)).toBe('ok');
  };

  describe('window', () => {
    it('claim creates the row, refuses within 60 seconds and restarts after', async () => {
      expect(await service.claim(email, now)).toBe(true);
      expect(await service.claim(email, after(59))).toBe(false);
      expect(await service.claim(email, after(60))).toBe(true);
      expect(await service.claim(email, after(61))).toBe(false);
    });

    it('a refused claim does not give attempts back, a successful one does', async () => {
      await service.claim(email, now);
      await useUpAttempts();
      await service.claim(email, after(30));
      expect(await service.attempt(email, after(30))).toBe('locked');
      await service.claim(email, after(60));
      expect(await service.attempt(email, after(60))).toBe('ok');
    });

    it('lets one of many parallel claims through, with and without a row', async () => {
      const claims = (at: Date) => Promise.all(Array.from({ length: 10 }, () => service.claim(email, at)));
      expect((await claims(now)).filter(Boolean)).toHaveLength(1);
      expect((await claims(after(60))).filter(Boolean)).toHaveLength(1);
    });

    it('shares one row between letter cases of an email', async () => {
      await service.claim('A@E2E.test', now);
      expect(await service.claim(email, now)).toBe(false);
    });
  });

  describe('attempt', () => {
    it('is expired without a row and after 10 minutes', async () => {
      expect(await service.attempt(email, now)).toBe('expired');
      await service.claim(email, now);
      expect(await service.attempt(email, after(599))).toBe('ok');
      expect(await service.attempt(email, after(600))).toBe('expired');
    });

    it('is locked from the 6th attempt, and expired wins over locked', async () => {
      await service.claim(email, now);
      await useUpAttempts();
      expect(await service.attempt(email, now)).toBe('locked');
      expect(await service.attempt(email, after(600))).toBe('expired');
    });

    it('lets 5 of 20 parallel attempts through', async () => {
      await service.claim(email, now);
      const results = await Promise.all(Array.from({ length: 20 }, () => service.attempt(email, now)));
      expect(results.filter((r) => r === 'ok')).toHaveLength(5);
    });
  });

  describe('codes', () => {
    const issue = async (at = now) => (await service.issueCode('u', at))!;

    it('issues 6 digits, stores only a hash and accepts the code once', async () => {
      const code = await issue();
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(codes)).not.toContain(`"${code}"`);
      const results = await Promise.all([service.consume('u', code, now), service.consume('u', code, now)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('refuses a wrong code, an expired code and the code of another user', async () => {
      const code = await issue();
      expect(await service.consume('u', code === '000000' ? '000001' : '000000', now)).toBe(false);
      expect(await service.consume('u', code, after(600))).toBe(false);
      expect(await service.consume('other', code, now)).toBe(false);
      expect(await service.consume('u', code, now)).toBe(true);
    });

    it('voids the old code when a new one is issued', async () => {
      await issue();
      const [old] = codes;
      await issue(after(60));
      expect(old.voidedAt).toEqual(after(60));
      expect(codes.filter((c) => !c.voidedAt)).toHaveLength(1);
    });

    it('sendCode emails the issued code, and nothing when a parallel request issued one first', async () => {
      const user = { id: 'u', email };
      const issueCode = jest.spyOn(service, 'issueCode');
      await service.sendCode(user);
      expect(sendVerificationCode).toHaveBeenCalledTimes(1);
      expect(sendVerificationCode).toHaveBeenCalledWith(user, await issueCode.mock.results[0].value);

      issueCode.mockResolvedValueOnce(null);
      await service.sendCode(user);
      expect(sendVerificationCode).toHaveBeenCalledTimes(1);
    });
  });
});
