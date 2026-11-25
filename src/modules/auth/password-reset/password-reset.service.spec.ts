import { Logger } from '@nestjs/common';
import { setBackgroundRunner } from '../../../cloudflare';
import type { PrismaService } from '../../../database/prisma.service';
import type { EmailService } from '../../email/email.service';
import type { PasswordService } from '../password/password.service';
import type { SendCooldownService } from '../send-cooldown.service';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService.forgotPassword', () => {
  const email = 'a@e2e.test';
  const account = { id: 'user-id', email, passwordHash: 'hash', deactivatedAt: null };
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const claim = jest.fn();
  const sendResetLink = jest.fn();
  let tasks: Promise<unknown>[];
  let warn: jest.SpyInstance;
  let service: PasswordResetService;

  beforeEach(() => {
    jest.resetAllMocks();
    tasks = [];
    setBackgroundRunner((task) => tasks.push(task));
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    claim.mockResolvedValue(true);
    findUnique.mockResolvedValue(account);
    service = new PasswordResetService(
      { user: { findUnique }, passwordResetToken: { updateMany, create: jest.fn() } } as unknown as PrismaService,
      {} as PasswordService,
      { claim } as unknown as SendCooldownService,
      { sendResetLink } as unknown as EmailService,
    );
  });

  afterAll(() => setBackgroundRunner(() => {}));

  it('answers before the link is written', async () => {
    updateMany.mockReturnValue(new Promise(() => {}));
    await expect(service.forgotPassword({ email })).resolves.toEqual({ sent: true });
    expect(sendResetLink).not.toHaveBeenCalled();
  });

  it('looks nobody up without a claim', async () => {
    claim.mockResolvedValue(false);
    await expect(service.forgotPassword({ email })).resolves.toEqual({ sent: true });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('logs the user id but no email when the link cannot be written, and still answers', async () => {
    updateMany.mockRejectedValue(new TypeError(`bad value ${email}`));
    await expect(service.forgotPassword({ email })).resolves.toEqual({ sent: true });
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(account.id);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain(email);
  });

  it('still answers when the background runner fails', async () => {
    setBackgroundRunner(() => {
      throw new Error('no context');
    });
    await expect(service.forgotPassword({ email })).resolves.toEqual({ sent: true });
    expect(JSON.stringify(warn.mock.calls)).toContain(account.id);
  });
});
