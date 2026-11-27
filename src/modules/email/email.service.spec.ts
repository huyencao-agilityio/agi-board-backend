import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { setBackgroundRunner } from '../../cloudflare';
import type { Env } from '../../config/env';
import { EmailService } from './email.service';

const to = { id: 'user-id', email: 'a@example.com' };
const service = (env: Record<string, string>) =>
  new EmailService({
    get: (key: string) => ({ NODE_ENV: 'development', ...env })[key],
  } as unknown as ConfigService<Env, true>);

describe('EmailService', () => {
  let tasks: Promise<unknown>[];
  let fetchMock: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    tasks = [];
    setBackgroundRunner((task) => tasks.push(task));
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as unknown };
  };

  it('sends through Resend when there is a key', async () => {
    service({ EMAIL_API_KEY: 'key', EMAIL_FROM: 'X <x@example.com>' }).sendVerificationCode(to, '012345');
    await Promise.all(tasks);
    expect(sent().url).toBe('https://api.resend.com/emails');
    expect(sent().headers.Authorization).toBe('Bearer key');
    expect(sent().body).toMatchObject({ from: 'X <x@example.com>', to: [to.email] });
    expect(JSON.stringify(sent().body)).toContain('012345');
  });

  it('sends to Mailpit without a key', async () => {
    service({}).sendVerificationCode(to, '012345');
    await Promise.all(tasks);
    expect(sent().url).toBe('http://localhost:8025/api/v1/send');
    expect(sent().body).toMatchObject({ To: [{ Email: to.email }] });
    expect(JSON.stringify(sent().body)).toContain('012345');
  });

  it('sends the reset link with the token in the fragment', async () => {
    service({ APP_ORIGIN: 'https://app.example.com' }).sendResetLink(to, 'tok');
    await Promise.all(tasks);
    expect(sent().body).toMatchObject({ To: [{ Email: to.email }] });
    expect((sent().body as { Text: string }).Text).toContain('https://app.example.com/reset-password#token=tok\n');
  });

  it('sends the Google notice without a reset link', async () => {
    service({ APP_ORIGIN: 'https://app.example.com' }).sendGoogleSignInNotice(to);
    await Promise.all(tasks);
    const { Text } = sent().body as { Text: string };
    expect(Text).toContain('https://app.example.com/sign-in');
    expect(Text).not.toContain('token');
  });

  it('sends the workspace invite with inviter, workspace and app link', async () => {
    service({ APP_ORIGIN: 'https://app.example.com' }).sendWorkspaceInvite(to, 'Ada Admin', 'Marketing');
    await Promise.all(tasks);
    const { To, Subject, Text } = sent().body as { To: unknown; Subject: string; Text: string };
    expect(To).toEqual([{ Email: to.email }]);
    expect(Subject).toContain('Ada Admin');
    expect(Text).toContain('Ada Admin');
    expect(Text).toContain('"Marketing"');
    expect(Text).toContain('https://app.example.com/');
    expect(Text).not.toContain('token');
  });

  it('puts user-written names in the invite email on one bounded line', async () => {
    const evil = `IT Security\r\n\nVerify now: https://evil.example\u2028${'x'.repeat(200)}`;
    service({ APP_ORIGIN: 'https://app.example.com' }).sendWorkspaceInvite(to, evil, 'W\nX');
    await Promise.all(tasks);
    const { Subject, Text } = sent().body as { Subject: string; Text: string };
    expect(Subject).not.toMatch(/[\r\n\u2028]/);
    expect(Text.split('\n')[0]).toContain('IT Security Verify now: https://evil.example');
    expect(Text.split('\n')[0]).toContain('"W X"');
    expect(Text.split('\n')[0].length).toBeLessThan(200);
  });

  it('logs neither the address nor the reset token when sending fails', async () => {
    fetchMock.mockRejectedValue(new TypeError(`cannot reach ${to.email}`));
    service({ APP_ORIGIN: 'https://app.example.com' }).sendResetLink(to, 'secret-token');
    await Promise.all(tasks);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(to.id);
    expect(logged).not.toContain(to.email);
    expect(logged).not.toContain('secret-token');
  });

  it('sends nothing in tests, even with a key', () => {
    service({ NODE_ENV: 'test', EMAIL_API_KEY: 'key' }).sendVerificationCode(to, '012345');
    expect(tasks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when the background runner fails', () => {
    setBackgroundRunner(() => {
      throw new Error('no context');
    });
    expect(() => service({}).sendVerificationCode(to, '012345')).not.toThrow();
    expect(JSON.stringify(warn.mock.calls)).toContain(to.id);
  });

  it.each([
    ['an error status', () => fetchMock.mockResolvedValue(new Response(`no ${to.email}`, { status: 422 }))],
    ['a network error', () => fetchMock.mockRejectedValue(new TypeError(`cannot reach ${to.email}`))],
  ])('logs the user id but no address or code, and does not reject, on %s', async (_name, arrange) => {
    arrange();
    service({ EMAIL_API_KEY: 'key' }).sendVerificationCode(to, '012345');
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(to.id);
    expect(logged).not.toContain(to.email);
    expect(logged).not.toContain('012345');
  });
});
