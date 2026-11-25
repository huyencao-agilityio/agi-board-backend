import type { Request, Response } from 'express';
import type { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { PasswordService } from '../password/password.service';
import type { SessionService } from '../session/session.service';
import type { EmailVerificationService } from './email-verification.service';
import { SignUpService } from './sign-up.service';

const email = 'a@e2e.test';
const signUpDto = { email, fullName: 'Ann', password: 'abcd1234' };
const verifyDto = { email, code: '123456', password: 'abcd1234' };
const req = {} as Request;
const res = {} as Response;
const unverified = { id: 'u1', email, passwordHash: 'old', emailVerifiedAt: null, deactivatedAt: null };
const onlyUnverified = { id: 'u1', emailVerifiedAt: null, deactivatedAt: null, passwordHash: { not: null } };
const refused = { status: 409, response: { code: 'EMAIL_ALREADY_EXISTS' } };

const closedAccounts: [string, object][] = [
  ['verified', { ...unverified, emailVerifiedAt: new Date() }],
  ['Google-only', { ...unverified, passwordHash: null }],
  ['deactivated', { ...unverified, deactivatedAt: new Date() }],
];

describe('SignUpService', () => {
  const user = { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), updateMany: jest.fn() };
  const userSession = { updateMany: jest.fn() };
  const passwordResetToken = { updateMany: jest.fn() };
  const passwords = { hash: jest.fn() };
  const verification = { claim: jest.fn(), attempt: jest.fn(), consume: jest.fn(), sendCode: jest.fn() };
  const sessions = { createSession: jest.fn() };
  let service: SignUpService;

  beforeEach(() => {
    jest.resetAllMocks();
    passwords.hash.mockResolvedValue('new');
    verification.claim.mockResolvedValue(true);
    verification.attempt.mockResolvedValue('ok');
    verification.consume.mockResolvedValue(true);
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({ id: 'u1', email });
    user.updateMany.mockResolvedValue({ count: 1 });
    service = new SignUpService(
      { user, userSession, passwordResetToken } as unknown as PrismaService,
      passwords as unknown as PasswordService,
      verification as unknown as EmailVerificationService,
      sessions as unknown as SessionService,
    );
  });

  const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];

  describe('signUp', () => {
    it.each(closedAccounts)('refuses a %s account and changes nothing', async (_case, row) => {
      user.findUnique.mockResolvedValue(row);
      await expect(service.signUp(signUpDto)).rejects.toMatchObject(refused);
      expect(verification.claim).not.toHaveBeenCalled();
      expect(user.create).not.toHaveBeenCalled();
      expect(user.updateMany).not.toHaveBeenCalled();
    });

    it('claims the window before it creates the account, then sends a code', async () => {
      expect(await service.signUp(signUpDto)).toEqual({ next: 'verify-email' });
      expect(order(passwords.hash)).toBeLessThan(order(verification.claim));
      expect(order(verification.claim)).toBeLessThan(order(user.create));
      expect(verification.sendCode).toHaveBeenCalledWith({ id: 'u1', email });
    });

    it('creates the account but sends no code without a claim', async () => {
      verification.claim.mockResolvedValue(false);
      await service.signUp(signUpDto);
      expect(user.create).toHaveBeenCalledTimes(1);
      expect(verification.sendCode).not.toHaveBeenCalled();
    });

    it('replaces the password and name of an unverified account', async () => {
      user.findUnique.mockResolvedValue(unverified);
      user.findUniqueOrThrow.mockResolvedValue(unverified);
      await service.signUp(signUpDto);
      expect(user.updateMany).toHaveBeenCalledWith({
        where: onlyUnverified,
        data: { passwordHash: 'new', fullName: 'Ann' },
      });
      expect(verification.sendCode).toHaveBeenCalledWith(unverified);
    });

    it('changes nothing on an unverified account without a claim', async () => {
      user.findUnique.mockResolvedValue(unverified);
      verification.claim.mockResolvedValue(false);
      expect(await service.signUp(signUpDto)).toEqual({ next: 'verify-email' });
      expect(user.updateMany).not.toHaveBeenCalled();
      expect(verification.sendCode).not.toHaveBeenCalled();
    });

    it('signs up again when a parallel request created the account first', async () => {
      user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2002', clientVersion: 'test' }),
      );
      user.findUniqueOrThrow.mockResolvedValue(unverified);
      await service.signUp(signUpDto);
      expect(user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('does not hide other database errors', async () => {
      user.create.mockRejectedValue(new Error('down'));
      await expect(service.signUp(signUpDto)).rejects.toThrow('down');
    });

    it.each(closedAccounts)('refuses when the account became %s after the first lookup', async (_case, row) => {
      user.findUnique.mockResolvedValue(unverified);
      user.findUniqueOrThrow.mockResolvedValue(row);
      await expect(service.signUp(signUpDto)).rejects.toMatchObject(refused);
      expect(user.updateMany).not.toHaveBeenCalled();
    });

    it('refuses and sends nothing when the conditional update matches no row', async () => {
      user.findUnique.mockResolvedValue(unverified);
      user.findUniqueOrThrow.mockResolvedValue(unverified);
      user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.signUp(signUpDto)).rejects.toMatchObject(refused);
      expect(verification.sendCode).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    const verify = () => service.verifyEmail(verifyDto, req, res);
    const incorrect = { status: 400, response: { code: 'INCORRECT_CODE' } };

    it.each([
      ['locked', 429, 'CODE_LOCKED'],
      ['expired', 400, 'CODE_EXPIRED'],
    ])('answers a %s window before any lookup', async (attempt, status, code) => {
      verification.attempt.mockResolvedValue(attempt);
      await expect(verify()).rejects.toMatchObject({ status, response: { code } });
      expect(user.findUnique).not.toHaveBeenCalled();
      expect(verification.consume).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown email', null],
      ['a verified account', { ...unverified, emailVerifiedAt: new Date() }],
      ['a Google-only account', { ...unverified, passwordHash: null }],
    ])('answers INCORRECT_CODE for %s without using up a code', async (_case, row) => {
      user.findUnique.mockResolvedValue(row);
      await expect(verify()).rejects.toMatchObject(incorrect);
      expect(verification.consume).not.toHaveBeenCalled();
    });

    it('answers INCORRECT_CODE for a wrong code, also on a deactivated account', async () => {
      user.findUnique.mockResolvedValue({ ...unverified, deactivatedAt: new Date() });
      verification.consume.mockResolvedValue(false);
      await expect(verify()).rejects.toMatchObject(incorrect);
      expect(user.updateMany).not.toHaveBeenCalled();
    });

    it('tells a deactivated account only after the right code', async () => {
      user.findUnique.mockResolvedValue({ ...unverified, deactivatedAt: new Date() });
      await expect(verify()).rejects.toMatchObject({ status: 403, response: { code: 'ACCOUNT_DEACTIVATED' } });
      expect(verification.consume).toHaveBeenCalledWith('u1', verifyDto.code);
      expect(user.updateMany).not.toHaveBeenCalled();
    });

    it('ends no session and opens none when the conditional update matches no row', async () => {
      user.findUnique.mockResolvedValue(unverified);
      user.updateMany.mockResolvedValue({ count: 0 });
      await expect(verify()).rejects.toMatchObject(incorrect);
      expect(userSession.updateMany).not.toHaveBeenCalled();
      expect(sessions.createSession).not.toHaveBeenCalled();
    });

    it('stores the new password, ends older sessions, then opens one', async () => {
      user.findUnique.mockResolvedValue(unverified);
      sessions.createSession.mockResolvedValue('session');
      expect(await verify()).toBe('session');
      expect(user.updateMany).toHaveBeenCalledWith({
        where: onlyUnverified,
        data: { passwordHash: 'new', emailVerifiedAt: expect.any(Date) as Date },
      });
      expect(userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', endedAt: null },
        data: { endedAt: expect.any(Date) as Date, endReason: 'password_reset' },
      });
      expect(passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null, voidedAt: null },
        data: { voidedAt: expect.any(Date) as Date },
      });
      expect(order(passwordResetToken.updateMany)).toBeLessThan(order(user.updateMany));
      expect(order(user.updateMany)).toBeLessThan(order(userSession.updateMany));
      expect(order(userSession.updateMany)).toBeLessThan(order(sessions.createSession));
    });
  });

  describe('resendCode', () => {
    it('refuses within the cooldown before any lookup', async () => {
      verification.claim.mockResolvedValue(false);
      await expect(service.resendCode({ email })).rejects.toMatchObject({
        status: 429,
        response: { code: 'RESEND_TOO_SOON' },
      });
      expect(user.findUnique).not.toHaveBeenCalled();
    });

    it.each([['unknown', null], ...closedAccounts])(
      'answers the same and sends nothing for a %s account',
      async (_case, row) => {
        user.findUnique.mockResolvedValue(row);
        expect(await service.resendCode({ email })).toEqual({ sent: true });
        expect(verification.sendCode).not.toHaveBeenCalled();
      },
    );

    it('sends a code to an unverified account', async () => {
      user.findUnique.mockResolvedValue(unverified);
      expect(await service.resendCode({ email })).toEqual({ sent: true });
      expect(verification.sendCode).toHaveBeenCalledWith(unverified);
    });
  });
});
