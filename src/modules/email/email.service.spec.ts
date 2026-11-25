import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { setBackgroundRunner } from '../../cloudflare';
import type { Env } from '../../config/env';
import { EmailService } from './email.service';

const to = { id: 'user-id', email: 'a@example.com' };
const service = (env: Record<string, string>) =>
  new EmailService({
    get: (key: string) => ({ APP_ORIGIN: 'http://localhost:5173', NODE_ENV: 'development', ...env })[key],
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
    service({}).sendAccountExists(to);
    await Promise.all(tasks);
    expect(sent().url).toBe('http://localhost:8025/api/v1/send');
    expect(sent().body).toMatchObject({ To: [{ Email: to.email }] });
    expect(JSON.stringify(sent().body)).toContain('http://localhost:5173/sign-in');
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
