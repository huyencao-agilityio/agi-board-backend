import type { ConfigService } from '@nestjs/config';
import { setBindings, type Bindings } from '../../../cloudflare';
import type { SessionUser } from '../../../common/guards/session.guard';
import type { Env } from '../../../config/env';
import type { PrismaService } from '../../../database/prisma.service';
import type { PasswordService } from '../password/password.service';
import type { SignInThrottleService } from '../sign-in/sign-in-throttle.service';
import { AccountSecurityService, SAME_AS_CURRENT } from './account-security.service';

const user: SessionUser = { id: 'u1', email: 'jane@example.com', fullName: 'J', systemRole: 'user', sessionId: 's1' };
const dto = { currentPassword: 'old-pass1', newPassword: 'new-pass2' };

describe('AccountSecurityService', () => {
  const findUniqueOrThrow = jest.fn();
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const passwords = { verify: jest.fn(), hash: jest.fn() };
  const throttle = { attempt: jest.fn(), recordFailure: jest.fn(), reset: jest.fn() };
  const batch = jest.fn();
  let service: AccountSecurityService;

  beforeEach(() => {
    jest.resetAllMocks();
    findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: user.email, passwordHash: 'stored' });
    throttle.attempt.mockResolvedValue(true);
    passwords.verify.mockResolvedValue(true);
    passwords.hash.mockResolvedValue('new-hash');
    batch.mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 2 } }, { meta: { changes: 1 } }]);
    const prepare = () => ({ bind: (...args: unknown[]) => args });
    setBindings({ DB: { batch, prepare } } as unknown as Bindings);
    service = new AccountSecurityService(
      { user: { findUniqueOrThrow }, userSession: { findMany, updateMany } } as unknown as PrismaService,
      passwords as unknown as PasswordService,
      throttle as unknown as SignInThrottleService,
      { get: () => 30 } as unknown as ConfigService<Env, true>,
    );
  });

  describe('changePassword', () => {
    it('counts the attempt before checking the current password, keyed by user id', async () => {
      await service.changePassword(user, dto);
      expect(throttle.attempt).toHaveBeenCalledWith('u1', 'change_password');
      expect(throttle.attempt.mock.invocationCallOrder[0]).toBeLessThan(passwords.verify.mock.invocationCallOrder[0]);
      expect(batch).toHaveBeenCalledTimes(1);
    });

    it('429 when locked, without verifying', async () => {
      throttle.attempt.mockResolvedValue(false);
      await expect(service.changePassword(user, dto)).rejects.toMatchObject({
        status: 429,
        response: { code: 'CHANGE_PASSWORD_LOCKED' },
      });
      expect(passwords.verify).not.toHaveBeenCalled();
    });

    it('400 CURRENT_PASSWORD_INCORRECT and a recorded failure for a wrong current password', async () => {
      passwords.verify.mockResolvedValue(false);
      await expect(service.changePassword(user, dto)).rejects.toMatchObject({
        status: 400,
        response: { code: 'CURRENT_PASSWORD_INCORRECT' },
      });
      expect(throttle.recordFailure).toHaveBeenCalledWith('u1', 'change_password');
      expect(batch).not.toHaveBeenCalled();
    });

    it('400 with the broken rules for a weak new password, before any write', async () => {
      await expect(service.changePassword(user, { ...dto, newPassword: 'jane1234' })).rejects.toMatchObject({
        status: 400,
        response: { message: ['password must not contain the email name'] },
      });
      expect(batch).not.toHaveBeenCalled();
      // The current password was right, so it is not counted as a failure.
      expect(throttle.reset).toHaveBeenCalledWith('u1', 'change_password');
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });

    it('400 when the new password equals the current one, before hashing', async () => {
      await expect(
        service.changePassword(user, { currentPassword: 'same-pass1', newPassword: 'same-pass1' }),
      ).rejects.toMatchObject({ status: 400, response: { message: [SAME_AS_CURRENT] } });
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(batch).not.toHaveBeenCalled();
    });

    it('400 PASSWORD_NOT_SET for a Google-only account, without counting an attempt', async () => {
      findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: user.email, passwordHash: null });
      await expect(service.changePassword(user, dto)).rejects.toMatchObject({
        status: 400,
        response: { code: 'PASSWORD_NOT_SET' },
      });
      expect(throttle.attempt).not.toHaveBeenCalled();
    });

    it('400 CURRENT_PASSWORD_INCORRECT when the password changed meanwhile', async () => {
      batch.mockResolvedValue([{ meta: { changes: 0 } }, { meta: { changes: 0 } }, { meta: { changes: 0 } }]);
      await expect(service.changePassword(user, dto)).rejects.toMatchObject({
        response: { code: 'CURRENT_PASSWORD_INCORRECT' },
      });
    });
  });

  describe('sessions', () => {
    it('lists live sessions within the idle window and marks the current one', async () => {
      const now = new Date('2026-11-26T00:00:00Z');
      findMany.mockResolvedValue([
        { id: 's1', userAgent: 'A', createdAt: now, lastActiveAt: now },
        { id: 's2', userAgent: null, createdAt: now, lastActiveAt: now },
      ]);
      const { items } = await service.listSessions(user, now);
      expect(items.map((s) => [s.id, s.isCurrent])).toEqual([
        ['s1', true],
        ['s2', false],
      ]);
      const where = (findMany.mock.calls[0] as [{ where: { lastActiveAt: { gt: Date } } }])[0].where;
      expect(where.lastActiveAt.gt).toEqual(new Date('2026-10-27T00:00:00Z'));
    });

    it('endSession refuses the current session without writing', async () => {
      await expect(service.endSession(user, 's1')).rejects.toMatchObject({
        status: 400,
        response: { code: 'CURRENT_SESSION' },
      });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('endSession is 404 when no live session of this user matches', async () => {
      updateMany.mockResolvedValue({ count: 0 });
      await expect(service.endSession(user, 's9')).rejects.toMatchObject({
        status: 404,
        response: { code: 'SESSION_NOT_FOUND' },
      });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's9', userId: 'u1', endedAt: null, lastActiveAt: { gt: expect.any(Date) as Date } },
        }),
      );
    });

    it('endOtherSessions keeps the current session', async () => {
      updateMany.mockResolvedValue({ count: 2 });
      await service.endOtherSessions(user);
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', endedAt: null, id: { not: 's1' } } }),
      );
    });
  });
});
