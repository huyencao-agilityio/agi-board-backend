import type { Request, Response } from 'express';
import type { PrismaService } from '../../../database/prisma.service';
import type { PasswordService } from '../password/password.service';
import type { SessionService } from '../session/session.service';
import type { EmailVerificationService } from '../sign-up/email-verification.service';
import type { SignInThrottleService } from './sign-in-throttle.service';
import { SignInService } from './sign-in.service';

const dto = { email: 'a@e2e.test', password: 'abcd1234' };
const req = {} as Request;
const res = {} as Response;
const account = {
  id: 'u1',
  email: dto.email,
  passwordHash: 'stored' as string | null,
  emailVerifiedAt: new Date() as Date | null,
  deactivatedAt: null as Date | null,
};

describe('SignInService', () => {
  const findUnique = jest.fn();
  const passwords = { verify: jest.fn(), verifyDummy: jest.fn() };
  const throttle = { attempt: jest.fn(), recordFailure: jest.fn(), reset: jest.fn() };
  const verification = { claim: jest.fn(), sendCode: jest.fn() };
  const sessions = { createSession: jest.fn(), toResult: jest.fn() };
  let service: SignInService;

  beforeEach(() => {
    jest.resetAllMocks();
    throttle.attempt.mockResolvedValue(true);
    passwords.verify.mockResolvedValue(true);
    passwords.verifyDummy.mockResolvedValue(false);
    service = new SignInService(
      { user: { findUnique } } as unknown as PrismaService,
      passwords as unknown as PasswordService,
      throttle as unknown as SignInThrottleService,
      verification as unknown as EmailVerificationService,
      sessions as unknown as SessionService,
    );
  });

  const signIn = () => service.signIn(dto, req, res);

  it('refuses a locked email before any lookup or password check', async () => {
    throttle.attempt.mockResolvedValue(false);
    await expect(signIn()).rejects.toMatchObject({ status: 429, response: { code: 'SIGN_IN_LOCKED' } });
    expect(findUnique).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(passwords.verifyDummy).not.toHaveBeenCalled();
  });

  it('counts the attempt before the password is checked', async () => {
    findUnique.mockResolvedValue(account);
    await signIn();
    expect(throttle.attempt.mock.invocationCallOrder[0]).toBeLessThan(passwords.verify.mock.invocationCallOrder[0]);
  });

  it.each([
    ['an unknown email', null],
    ['a Google-only account', { ...account, passwordHash: null }],
  ])('pays for one derivation for %s and answers INVALID_CREDENTIALS', async (_case, user) => {
    findUnique.mockResolvedValue(user);
    await expect(signIn()).rejects.toMatchObject({ status: 401, response: { code: 'INVALID_CREDENTIALS' } });
    expect(passwords.verifyDummy).toHaveBeenCalledTimes(1);
    expect(throttle.recordFailure).toHaveBeenCalledWith(dto.email);
    expect(throttle.reset).not.toHaveBeenCalled();
  });

  it('answers INVALID_CREDENTIALS and records the failure for a wrong password', async () => {
    findUnique.mockResolvedValue(account);
    passwords.verify.mockResolvedValue(false);
    await expect(signIn()).rejects.toMatchObject({ status: 401, response: { code: 'INVALID_CREDENTIALS' } });
    expect(throttle.recordFailure).toHaveBeenCalledWith(dto.email);
    expect(throttle.reset).not.toHaveBeenCalled();
  });

  it('refuses a deactivated account after clearing the count', async () => {
    findUnique.mockResolvedValue({ ...account, deactivatedAt: new Date() });
    await expect(signIn()).rejects.toMatchObject({ status: 403, response: { code: 'ACCOUNT_DEACTIVATED' } });
    expect(throttle.reset).toHaveBeenCalledWith(dto.email);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('opens no session for an unverified account (claim %s: %i code)', async (claimed, sent) => {
    findUnique.mockResolvedValue({ ...account, emailVerifiedAt: null });
    verification.claim.mockResolvedValue(claimed);
    sessions.toResult.mockReturnValue('result');
    expect(await signIn()).toBe('result');
    expect(verification.sendCode).toHaveBeenCalledTimes(sent);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('opens a session for a verified account', async () => {
    findUnique.mockResolvedValue(account);
    sessions.createSession.mockResolvedValue('session');
    expect(await signIn()).toBe('session');
    expect(throttle.reset).toHaveBeenCalledWith(dto.email);
    expect(sessions.createSession).toHaveBeenCalledWith(account, req, res);
  });
});
