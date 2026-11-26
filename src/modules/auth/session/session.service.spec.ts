import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { hashSessionToken } from '../../../common/session-token';
import type { Env } from '../../../config/env';
import type { PrismaService } from '../../../database/prisma.service';
import { SessionService } from './session.service';

const CONFIG: Record<string, unknown> = { SESSION_COOKIE_NAME: 'agi_sid', SESSION_IDLE_DAYS: 14, NODE_ENV: 'test' };

const user = {
  id: 'u1',
  email: 'a@e2e.test',
  fullName: 'Ann',
  systemRole: 'user' as const,
  emailVerifiedAt: new Date(),
};
const publicUser = { id: 'u1', email: 'a@e2e.test', fullName: 'Ann', systemRole: 'user' };

const request = (headers: Record<string, string>, ip?: string) =>
  ({ ip, get: (name: string) => headers[name] }) as unknown as Request;

interface Update {
  data: { sessions: { create: { tokenHash: string; userAgent: string | null; ipAddress: string | null } } };
}

describe('SessionService', () => {
  const update = jest.fn<Promise<object>, [Update]>(() => Promise.resolve({}));
  const findUniqueOrThrow = jest.fn();
  const updateMany = jest.fn();
  const findUnique = jest.fn();
  const cookie = jest.fn<void, [name: string, value: string, options: object]>();
  const clearCookie = jest.fn<void, [name: string, options: object]>();
  const res = { cookie, clearCookie } as unknown as Response;
  let service: SessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService(
      { user: { update, findUniqueOrThrow }, userSession: { updateMany, findUnique } } as unknown as PrismaService,
      { get: (key: string) => CONFIG[key] } as unknown as ConfigService<Env, true>,
    );
  });

  const stored = () => update.mock.calls[0][0].data.sessions.create;

  it('stores only the hash of the token the cookie carries', async () => {
    await service.createSession(user, request({}), res);
    const [name, token] = cookie.mock.calls[0];
    expect(name).toBe('agi_sid');
    expect(stored().tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(update.mock.calls)).not.toContain(token);
  });

  it('cuts the user agent at 512 characters and prefers the Cloudflare IP', async () => {
    const headers = { 'user-agent': 'x'.repeat(600), 'cf-connecting-ip': '203.0.113.1' };
    await service.createSession(user, request(headers, '10.0.0.1'), res);
    expect(stored().userAgent).toHaveLength(512);
    expect(stored().ipAddress).toBe('203.0.113.1');
  });

  it('falls back to the request IP, then to null', async () => {
    await service.createSession(user, request({}, '10.0.0.1'), res);
    expect(stored()).toMatchObject({ userAgent: null, ipAddress: '10.0.0.1' });
    update.mockClear();
    await service.createSession(user, request({}), res);
    expect(stored().ipAddress).toBeNull();
  });

  it('keeps the session when the checked password is still the current one', async () => {
    findUniqueOrThrow.mockResolvedValueOnce({ passwordHash: 'h' });
    await service.createSession(user, request({}), res, 'h');
    expect(cookie).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([['new'], [null]])('ends the session and sets no cookie when the password became %s', async (now) => {
    findUniqueOrThrow.mockResolvedValueOnce({ passwordHash: now });
    await expect(service.createSession(user, request({}), res, 'h')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_CREDENTIALS' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { tokenHash: stored().tokenHash, endedAt: null },
      data: { endedAt: expect.any(Date) as Date, endReason: 'password_reset' },
    });
    expect(cookie).not.toHaveBeenCalled();
  });

  it('returns only the public fields and where to go next', () => {
    const row = { ...user, passwordHash: 'secret' };
    expect(service.toResult(row)).toEqual({ user: publicUser, next: 'home' });
    expect(service.toResult({ ...row, emailVerifiedAt: null })).toEqual({ user: publicUser, next: 'verify-email' });
  });

  it('me returns the same shape', async () => {
    findUniqueOrThrow.mockResolvedValueOnce(user);
    expect(await service.me('u1')).toEqual({ user: publicUser, next: 'home' });
  });

  describe('logout', () => {
    const withCookie = (token?: string) => ({ cookies: token ? { agi_sid: token } : {} }) as unknown as Request;
    const cleared = () => clearCookie.mock.calls.map(([name]) => name);

    it('ends only the live session of the cookie with reason logout and clears both cookies', async () => {
      updateMany.mockResolvedValueOnce({ count: 1 });
      await service.logout(withCookie('tok'), res);
      expect(updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hashSessionToken('tok'), endedAt: null },
        data: { endedAt: expect.any(Date) as Date, endReason: 'logout' },
      });
      expect(findUnique).not.toHaveBeenCalled();
      expect(cleared()).toEqual(['agi_sid', 'csrf_token']);
      expect(clearCookie.mock.calls[0][1]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    });

    it('answers an already-ended session without writing again, and still clears the cookies', async () => {
      updateMany.mockResolvedValueOnce({ count: 0 });
      findUnique.mockResolvedValueOnce({ id: 's1' });
      await service.logout(withCookie('tok'), res);
      expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashSessionToken('tok') }, select: { id: true } });
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(cleared()).toEqual(['agi_sid', 'csrf_token']);
    });

    it('rejects a token that matches no session and clears nothing', async () => {
      updateMany.mockResolvedValueOnce({ count: 0 });
      findUnique.mockResolvedValueOnce(null);
      await expect(service.logout(withCookie('tok'), res)).rejects.toMatchObject({ status: 401 });
      expect(clearCookie).not.toHaveBeenCalled();
    });

    it('rejects a request without a session cookie before any query', async () => {
      await expect(service.logout(withCookie(), res)).rejects.toMatchObject({ status: 401 });
      expect(updateMany).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
      expect(clearCookie).not.toHaveBeenCalled();
    });
  });
});
