import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PrismaService } from '../../../database/prisma.service';
import { accountDeactivated } from '../auth-errors';
import type { SessionService } from '../session/session.service';
import type { GoogleOAuthService } from './google-oauth.service';
import { GoogleSignInService } from './google-sign-in.service';

const profile = { sub: 'g1', email: 'a@e2e.test', name: 'Ann' as string | null };
const req = {} as Request;
const res = {} as Response;
const account = {
  id: 'u1',
  email: profile.email,
  googleSubject: 'g1' as string | null,
  emailVerifiedAt: new Date('2026-01-01') as Date | null,
  deactivatedAt: null as Date | null,
};

interface Write {
  where?: object;
  data: Record<string, unknown>;
}

describe('GoogleSignInService', () => {
  const user = {
    findUnique: jest.fn(),
    create: jest.fn<Promise<unknown>, [Write]>(),
    update: jest.fn<Promise<unknown>, [Write]>(),
  };
  const userSession = { updateMany: jest.fn() };
  const oauth = { authenticate: jest.fn() };
  const sessions = { createSession: jest.fn() };
  let service: GoogleSignInService;

  beforeEach(() => {
    jest.resetAllMocks();
    sessions.createSession.mockResolvedValue({ next: 'home' });
    service = new GoogleSignInService(
      { user, userSession } as unknown as PrismaService,
      oauth as unknown as GoogleOAuthService,
      sessions as unknown as SessionService,
    );
  });

  describe('signIn', () => {
    const signIn = (p = profile) => service.signIn(p, req, res);
    /** Nothing under the Google id, this row under the email. */
    const foundByEmail = (row: object | null) => user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row);

    it('finds by Google id first and changes nothing', async () => {
      user.findUnique.mockResolvedValueOnce(account);
      await signIn();
      expect(user.findUnique).toHaveBeenCalledTimes(1);
      expect(user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { googleSubject: 'g1' } }));
      expect(user.update).not.toHaveBeenCalled();
      expect(sessions.createSession).toHaveBeenCalledWith(account, req, res);
    });

    it('creates a verified account, named after the email when Google sends no name', async () => {
      foundByEmail(null);
      user.create.mockResolvedValue(account);
      await signIn({ ...profile, name: null });
      expect(user.create.mock.calls[0][0].data).toEqual({
        email: profile.email,
        fullName: 'a',
        googleSubject: 'g1',
        emailVerifiedAt: expect.any(Date) as Date,
      });
    });

    it('linking an unverified account ends its sessions first, then drops its password', async () => {
      foundByEmail({ ...account, googleSubject: null, emailVerifiedAt: null });
      user.update.mockResolvedValue(account);
      await signIn();
      const [{ where, data }] = user.update.mock.calls[0];
      expect(where).toEqual({ id: 'u1', AND: { googleSubject: null, emailVerifiedAt: null } });
      expect(data).toEqual({ googleSubject: 'g1', emailVerifiedAt: expect.any(Date) as Date, passwordHash: null });
      expect(userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', endedAt: null },
        data: { endedAt: expect.any(Date) as Date, endReason: 'password_reset' },
      });
      expect(userSession.updateMany.mock.invocationCallOrder[0]).toBeLessThan(user.update.mock.invocationCallOrder[0]);
    });

    it('linking a verified account keeps its password and sessions', async () => {
      foundByEmail({ ...account, googleSubject: null });
      user.update.mockResolvedValue(account);
      await signIn();
      const [{ where, data }] = user.update.mock.calls[0];
      expect(where).toEqual({ id: 'u1', AND: { googleSubject: null, emailVerifiedAt: { not: null } } });
      expect(data).toEqual({ googleSubject: 'g1', emailVerifiedAt: account.emailVerifiedAt });
      expect(userSession.updateMany).not.toHaveBeenCalled();
    });

    it('refuses an email linked to another Google account', async () => {
      foundByEmail({ ...account, googleSubject: 'other' });
      await expect(signIn()).rejects.toMatchObject({ status: 401, response: { code: 'GOOGLE_ACCOUNT_MISMATCH' } });
      expect(sessions.createSession).not.toHaveBeenCalled();
    });

    it('refuses a deactivated account', async () => {
      user.findUnique.mockResolvedValueOnce({ ...account, deactivatedAt: new Date() });
      await expect(signIn()).rejects.toMatchObject({ status: 403, response: { code: 'ACCOUNT_DEACTIVATED' } });
      expect(sessions.createSession).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    const callback = (error?: string) =>
      service.handleCallback({ code: 'c', state: 's', error, cookie: 's.v' }, req, res);
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      oauth.authenticate.mockResolvedValue(profile);
    });
    afterEach(() => warn.mockRestore());

    it('goes back to sign-in without a message when the person declined', async () => {
      expect(await callback('access_denied')).toBe('/sign-in');
      expect(oauth.authenticate).not.toHaveBeenCalled();
    });

    it('answers google_failed when Google does not confirm the person', async () => {
      oauth.authenticate.mockRejectedValue(new Error('State mismatch'));
      expect(await callback()).toBe('/sign-in?error=google_failed');
      expect(oauth.authenticate).toHaveBeenCalledWith('c', 's', 's.v');
      expect(warn).toHaveBeenCalledWith('Google sign-in failed: State mismatch');
      expect(user.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ['home', '/home'],
      ['verify-email', '/verify-email'],
    ])('next %s goes to %s', async (next, path) => {
      jest.spyOn(service, 'signIn').mockResolvedValue({ next } as Awaited<ReturnType<GoogleSignInService['signIn']>>);
      expect(await callback()).toBe(path);
    });

    it('answers account_deactivated for a deactivated account', async () => {
      jest.spyOn(service, 'signIn').mockRejectedValue(accountDeactivated());
      expect(await callback()).toBe('/sign-in?error=account_deactivated');
    });

    it('answers google_failed and logs only the error class when signing in fails', async () => {
      jest.spyOn(service, 'signIn').mockRejectedValue(new TypeError('query with a@e2e.test'));
      expect(await callback()).toBe('/sign-in?error=google_failed');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Google sign-in failed while signing in: TypeError');
    });
  });
});
