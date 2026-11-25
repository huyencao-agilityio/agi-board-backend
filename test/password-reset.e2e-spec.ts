import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { getBindings, setBackgroundRunner } from '../src/cloudflare';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/modules/auth/password/password.service';
import { SignInThrottleService } from '../src/modules/auth/sign-in/sign-in-throttle.service';
import { EmailVerificationService } from '../src/modules/auth/sign-up/email-verification.service';
import { EmailService, type EmailRecipient } from '../src/modules/email/email.service';

jest.setTimeout(60_000);

interface ErrorBody {
  error: { code: string; details?: string[] };
}

describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  let links: { to: EmailRecipient; token: string }[] = [];
  let notices: EmailRecipient[] = [];
  let codes: EmailRecipient[] = [];
  let tasks: Promise<unknown>[] = [];
  const csrf = 'test-csrf-token';
  const oldPassword = 'old horse battery 1';
  const newPassword = 'fresh horse battery 2';
  const domain = '@reset.e2e.test';
  const email = `person${domain}`;

  const rawPost = (path: string, body: object, withCsrf = true) => {
    const req = request(app.getHttpServer()).post(`/api/v1/auth/${path}`).set('Cookie', `csrf_token=${csrf}`);
    return (withCsrf ? req.set('X-CSRF-Token', csrf) : req).send(body);
  };
  /** Posts, then waits for what the request left running in the background. */
  const post = async (path: string, body: object, withCsrf = true) => {
    const res = await rawPost(path, body, withCsrf);
    await Promise.all(tasks);
    return res;
  };
  const forgot = (to = email) => post('forgot-password', { email: to });
  const check = (token: unknown) => post('reset-password/check', { token });
  const reset = (token: unknown, password = newPassword) => post('reset-password', { token, password });
  const signIn = (password: string, to = email) => post('sign-in', { email: to, password });
  const code = (res: request.Response) => (res.body as ErrorBody).error.code;

  const makeUser = (data: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, fullName: 'Person', passwordHash, emailVerifiedAt: new Date(), ...data } });
  const googleOnly = { passwordHash: null, googleSubject: 'reset-e2e-google' };
  const findUser = (to = email) => prisma.user.findUniqueOrThrow({ where: { email: to } });
  const makeLink = async (userId: string, data: Record<string, unknown> = {}) => {
    const token = newSessionToken();
    await prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 60_000), ...data },
    });
    return token;
  };
  const tokenRows = () =>
    prisma.passwordResetToken.findMany({ where: { user: { email } }, orderBy: { createdAt: 'asc' } });
  const liveRows = async () => (await tokenRows()).filter((row) => !row.usedAt && !row.voidedAt);
  const subjectKey = (to: string) => createHash('sha256').update(to).digest('hex');
  const ageWindow = (seconds: number, to = email) =>
    prisma.authThrottle.updateMany({
      where: { scope: 'reset_email', subjectKey: subjectKey(to) },
      data: { lastSentAt: new Date(Date.now() - seconds * 1000) },
    });
  const makeSession = async (userId: string, data: Record<string, unknown> = {}) => {
    const token = newSessionToken();
    await prisma.userSession.create({ data: { userId, tokenHash: hashSessionToken(token), ...data } });
    return token;
  };
  const me = (token: string) => request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `agi_sid=${token}`);

  const emails = [email, `other${domain}`, `ghost${domain}`];
  const cleanUp = async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.authThrottle.deleteMany({ where: { subjectKey: { in: emails.map(subjectKey) } } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationCode: (to: EmailRecipient) => codes.push(to),
        sendResetLink: (to: EmailRecipient, token: string) => links.push({ to, token }),
        sendGoogleSignInNotice: (to: EmailRecipient) => notices.push(to),
      })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordService).hash(oldPassword);
    setBackgroundRunner((task) => tasks.push(task));
  });

  beforeEach(async () => {
    await cleanUp();
    links = [];
    notices = [];
    codes = [];
    tasks = [];
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    setBackgroundRunner(() => {});
    await cleanUp();
    await app.close();
  });

  describe('POST /auth/forgot-password', () => {
    it('emails one link and stores only its hash, valid for 30 minutes', async () => {
      const user = await makeUser();
      const before = Date.now();
      const res = await forgot();
      const after = Date.now();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: true });
      expect(JSON.stringify(res.headers['set-cookie'] ?? '')).not.toContain('agi_sid');
      expect(links).toHaveLength(1);
      expect(links[0].to).toEqual({ id: user.id, email });
      const rows = await tokenRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(createHash('sha256').update(links[0].token).digest('hex'));
      const minutes = 30 * 60_000;
      expect(rows[0].expiresAt.getTime()).toBeGreaterThanOrEqual(before + minutes);
      expect(rows[0].expiresAt.getTime()).toBeLessThanOrEqual(after + minutes);
      expect((await check(links[0].token)).body).toEqual({ email });
    });

    it.each([
      ['unverified', { emailVerifiedAt: null }],
      ['Google-linked', { googleSubject: 'reset-e2e-google' }],
    ])('emails a link to an account that is %s', async (_name, data) => {
      await makeUser(data);
      await forgot();
      expect(links).toHaveLength(1);
      expect(notices).toHaveLength(0);
    });

    it.each([
      ['a Google-only account', () => makeUser(googleOnly), 1],
      ['an unknown email', () => Promise.resolve(), 0],
      ['a deactivated account', () => makeUser({ deactivatedAt: new Date() }), 0],
      ['a deactivated Google-only account', () => makeUser({ ...googleOnly, deactivatedAt: new Date() }), 0],
    ])('answers the same for %s, without a link', async (_name, arrange, noticeCount) => {
      await arrange();
      for (const expectedNotices of [noticeCount, noticeCount]) {
        const res = await forgot(); // the second one is within the cooldown
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ sent: true });
        expect(notices).toHaveLength(expectedNotices);
      }
      expect(links).toHaveLength(0);
      expect(await tokenRows()).toHaveLength(0);
    });

    it('ignores spaces and letter case, also for the cooldown', async () => {
      await makeUser();
      await forgot(`  PERSON${domain.toUpperCase()} `);
      await forgot();
      expect(links).toHaveLength(1);
    });

    it('sends nothing and keeps the link within 60 seconds, and replaces it after', async () => {
      await makeUser();
      await forgot();
      await ageWindow(55);
      const repeat = await forgot();
      expect(repeat.status).toBe(200);
      expect(repeat.body).toEqual({ sent: true });
      expect(links).toHaveLength(1);
      expect((await check(links[0].token)).status).toBe(200);

      await ageWindow(61);
      await forgot();
      expect(links).toHaveLength(2);
      expect(code(await check(links[0].token))).toBe('RESET_LINK_INVALID');
      expect(code(await reset(links[0].token))).toBe('RESET_LINK_INVALID');
      expect((await check(links[1].token)).status).toBe(200);
      expect(await liveRows()).toHaveLength(1);
    });

    it('sends one email for parallel requests', async () => {
      await makeUser();
      const results = await Promise.all([1, 2, 3, 4].map(() => rawPost('forgot-password', { email })));
      await Promise.all(tasks);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(links).toHaveLength(1);
      expect(await liveRows()).toHaveLength(1);
    });

    it('does not share its window with verification codes', async () => {
      await makeUser({ emailVerifiedAt: null });
      await signIn(oldPassword);
      expect(codes).toHaveLength(1);
      await forgot();
      expect(links).toHaveLength(1);
    });

    it.each([
      ['an invalid email', { email: 'nope' }],
      ['no email', {}],
      ['an unknown field', { email, extra: 1 }],
    ])('refuses %s', async (_name, body) => {
      const res = await post('forgot-password', body);
      expect(res.status).toBe(400);
      expect(code(res)).toBe('VALIDATION_FAILED');
    });
  });

  it.each(['forgot-password', 'reset-password/check', 'reset-password'])('%s requires the CSRF token', async (path) => {
    const res = await post(path, { email, token: 'x', password: newPassword }, false);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('CSRF_INVALID');
  });

  /** Every link that must not work. */
  const invalidLinks: [string, () => Promise<string>][] = [
    ['unknown', () => Promise.resolve(newSessionToken())],
    ['empty', () => Promise.resolve('')],
    ['malformed', () => Promise.resolve('%%% not a token')],
    ['very long', () => Promise.resolve('a'.repeat(5000))],
    ['expired', async () => makeLink((await findUser()).id, { expiresAt: new Date(Date.now() - 1000) })],
    ['used', async () => makeLink((await findUser()).id, { usedAt: new Date() })],
    ['voided', async () => makeLink((await findUser()).id, { voidedAt: new Date() })],
    [
      'deactivated account',
      async () => {
        const { id } = await findUser();
        await prisma.user.update({ where: { id }, data: { deactivatedAt: new Date() } });
        return makeLink(id);
      },
    ],
    [
      'account without a password',
      async () => {
        const { id } = await findUser();
        await prisma.user.update({ where: { id }, data: googleOnly });
        return makeLink(id);
      },
    ],
  ];
  const linkError = {
    error: { code: 'RESET_LINK_INVALID', message: 'This link has expired or was already used.' },
  };

  describe('POST /auth/reset-password/check', () => {
    it('returns only the email of a valid link and does not use it up', async () => {
      const token = await makeLink((await makeUser()).id);
      for (let i = 0; i < 2; i++) {
        const res = await check(token);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ email });
      }
    });

    it.each(invalidLinks)('gives the link error for a link: %s', async (_name, arrange) => {
      await makeUser();
      const res = await check(await arrange());
      expect(res.status).toBe(400);
      expect(res.body).toEqual(linkError);
    });

    it.each([
      ['missing', {}],
      ['not a string', { token: 1 }],
    ])('refuses a token that is %s', async (_name, body) => {
      const res = await post('reset-password/check', body);
      expect(res.status).toBe(400);
      expect(code(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('replaces the password, uses the link once and opens no session', async () => {
      const user = await makeUser();
      const token = await makeLink(user.id);
      const res = await reset(token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ next: 'sign-in' });
      expect(JSON.stringify(res.headers['set-cookie'] ?? '')).not.toContain('agi_sid');

      expect((await reset(token, 'another horse 3')).body).toEqual(linkError);
      expect((await signIn(oldPassword)).status).toBe(401);
      expect((await signIn(newPassword)).status).toBe(200);
      const [row] = await tokenRows();
      expect(row.usedAt).toBeInstanceOf(Date);
      expect(Math.abs(row.usedAt!.getTime() - Date.now())).toBeLessThan(60_000);
      expect((await findUser()).updatedAt.getTime()).toBeGreaterThanOrEqual(user.updatedAt.getTime());
    });

    it('writes dates in the same form as Prisma', async () => {
      const user = await makeUser();
      await makeSession(user.id);
      await reset(await makeLink(user.id));
      // Read past Prisma, which would turn the text into dates.
      const raw = (await getBindings()
        .DB.prepare(
          `SELECT t.used_at AS used, t.created_at AS created, s.ended_at AS ended
           FROM password_reset_tokens t JOIN user_sessions s ON s.user_id = t.user_id WHERE t.user_id = ?`,
        )
        .bind(user.id)
        .first<{ used: string; created: string; ended: string }>())!;
      const form = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/;
      expect(raw.created).toMatch(form);
      expect(raw.used).toMatch(form);
      expect(raw.ended).toMatch(form);
    });

    it('ends every open session of the user, and only those', async () => {
      const user = await makeUser();
      const other = await makeUser({ email: `other${domain}` });
      const open = [await makeSession(user.id), await makeSession(user.id)];
      const loggedOut = await makeSession(user.id, { endedAt: new Date('2026-01-01'), endReason: 'logout' });
      const others = await makeSession(other.id);
      await reset(await makeLink(user.id));
      for (const token of open) {
        const res = await me(token);
        expect(res.status).toBe(401);
        expect(code(res)).toBe('SESSION_ENDED');
      }
      await me(others).expect(200);
      const kept = await prisma.userSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(loggedOut) } });
      expect(kept).toMatchObject({ endedAt: new Date('2026-01-01'), endReason: 'logout' });
      expect((await findUser(other.email)).passwordHash).toBe(passwordHash);
    });

    it('leaves no session to a sign-in that checked the old password just before the reset', async () => {
      const user = await makeUser();
      const token = await makeLink(user.id);
      const throttle = app.get(SignInThrottleService);
      const clear = throttle.reset.bind(throttle);
      // Runs between the password check and the new session.
      jest.spyOn(throttle, 'reset').mockImplementationOnce(async (to) => {
        expect((await rawPost('reset-password', { token, password: newPassword })).status).toBe(200);
        await clear(to);
      });
      const res = await signIn(oldPassword);
      expect(res.status).toBe(401);
      expect(code(res)).toBe('INVALID_CREDENTIALS');
      expect(JSON.stringify(res.headers['set-cookie'] ?? '')).not.toContain('agi_sid');
      expect(await prisma.userSession.count({ where: { userId: user.id, endedAt: null } })).toBe(0);
      expect((await signIn(newPassword)).status).toBe(200);
    });

    it('leaves no other link usable', async () => {
      await makeUser();
      await forgot();
      await ageWindow(61);
      await forgot();
      expect((await reset(links[1].token)).status).toBe(200);
      for (const { token } of links) {
        expect((await check(token)).body).toEqual(linkError);
        expect((await reset(token, 'another horse 3')).body).toEqual(linkError);
      }
      expect(await liveRows()).toHaveLength(0);
    });

    it('refuses a link after verify-email replaced the password', async () => {
      const user = await makeUser({ emailVerifiedAt: null });
      const token = await makeLink(user.id);
      const verification = app.get(EmailVerificationService);
      await verification.claim(email);
      const verifyCode = (await verification.issueCode(user.id))!;
      expect((await post('verify-email', { email, code: verifyCode, password: newPassword })).status).toBe(200);
      expect((await reset(token, 'another horse 3')).body).toEqual(linkError);
      expect((await signIn(newPassword)).status).toBe(200);
    });

    it('lifts the sign-in lock', async () => {
      const user = await makeUser();
      for (let i = 0; i < 5; i++) await signIn('wrong password 9');
      expect((await signIn(oldPassword)).status).toBe(429);
      await reset(await makeLink(user.id));
      expect((await signIn(newPassword)).status).toBe(200);
    });

    it('does not verify the email', async () => {
      const user = await makeUser({ emailVerifiedAt: null });
      await reset(await makeLink(user.id));
      expect((await findUser()).emailVerifiedAt).toBeNull();
      const res = await signIn(newPassword);
      expect(res.status).toBe(200);
      expect((res.body as { next: string }).next).toBe('verify-email');
    });

    it('accepts the old password as the new one', async () => {
      const user = await makeUser();
      expect((await reset(await makeLink(user.id), oldPassword)).status).toBe(200);
    });

    it.each(invalidLinks)('changes nothing for a link: %s', async (_name, arrange) => {
      const user = await makeUser();
      await makeSession(user.id);
      for (let i = 0; i < 5; i++) await signIn('wrong password 9');
      const token = await arrange();
      const before = await findUser();
      const res = await reset(token);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(linkError);
      expect(await findUser()).toEqual(before);
      expect(await prisma.userSession.count({ where: { userId: user.id, endedAt: null } })).toBe(1);
      expect((await signIn(oldPassword)).status).toBe(429);
    });

    it.each([
      ['under 8 characters', 'abc1234', 'at least 8'],
      ['over 128 characters', 'a1'.repeat(65), 'at most 128'],
      ['without a letter', '12345678', 'a letter'],
      ['without a number', 'abcdefgh', 'a number'],
      ['containing the email name in another case', 'xxPERSON123', 'email name'],
    ])('refuses a password %s and keeps the link', async (_name, password, detail) => {
      const token = await makeLink((await makeUser()).id);
      const res = await reset(token, password);
      expect(res.status).toBe(400);
      expect(code(res)).toBe('VALIDATION_FAILED');
      expect((res.body as ErrorBody).error.details).toEqual([expect.stringContaining(detail)]);
      expect((await reset(token)).status).toBe(200);
    });

    it('lets one of several parallel resets through, and its password wins', async () => {
      const user = await makeUser();
      const token = await makeLink(user.id);
      const passwords = ['parallel one 1', 'parallel two 2', 'parallel three 3'];
      const results = await Promise.all(passwords.map((password) => rawPost('reset-password', { token, password })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
      const winner = passwords[results.findIndex((r) => r.status === 200)];
      expect((await signIn(winner)).status).toBe(200);
    });

    it.each<[string, (userId: string) => Promise<unknown>]>([
      [
        'the account is deactivated',
        (id) => prisma.user.update({ where: { id }, data: { deactivatedAt: new Date() } }),
      ],
      ['the account loses its password', (id) => prisma.user.update({ where: { id }, data: googleOnly })],
      [
        'the link is voided',
        (userId) => prisma.passwordResetToken.updateMany({ where: { userId }, data: { voidedAt: new Date() } }),
      ],
      [
        'the link expires',
        (userId) =>
          prisma.passwordResetToken.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      ],
    ])('changes nothing when %s while the reset runs', async (_name, change) => {
      const user = await makeUser();
      const token = await makeLink(user.id);
      await makeSession(user.id);
      for (let i = 0; i < 5; i++) await signIn('wrong password 9');
      const passwords = app.get(PasswordService);
      const hash = passwords.hash.bind(passwords);
      let changed: string | null | undefined;
      jest.spyOn(passwords, 'hash').mockImplementationOnce(async (password) => {
        await change(user.id);
        changed = (await findUser()).passwordHash;
        return hash(password);
      });
      expect((await reset(token)).body).toEqual(linkError);
      expect(changed).not.toBeUndefined();
      expect((await findUser()).passwordHash).toBe(changed);
      expect(await prisma.userSession.count({ where: { userId: user.id, endedAt: null } })).toBe(1);
      expect((await tokenRows())[0].usedAt).toBeNull();
      expect((await signIn(oldPassword)).status).toBe(429);
    });
  });
});
