import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { EmailVerificationService } from '../src/modules/auth/email-verification.service';
import { EmailService, type EmailRecipient } from '../src/modules/email/email.service';

jest.setTimeout(60_000);

describe('Sign up and email verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  let codesSent: { to: EmailRecipient; code: string }[] = [];
  const csrf = 'test-csrf-token';
  const oldPassword = 'old horse battery 1';
  const password = 'fresh horse battery 2';
  const domain = '@signup.e2e.test';
  const email = `new${domain}`;

  const post = (path: string, body: object, withCsrf = true) => {
    const req = request(app.getHttpServer()).post(`/api/v1/auth/${path}`).set('Cookie', `csrf_token=${csrf}`);
    return (withCsrf ? req.set('X-CSRF-Token', csrf) : req).send(body);
  };
  const signUp = (body: object = {}) => post('sign-up', { fullName: 'New User', email, password, ...body });
  const verify = (code: string, to = email, pass = password) =>
    post('verify-email', { email: to, code, password: pass });
  const resend = (to = email) => post('resend-code', { email: to });
  const signIn = (pass: string, to = email) => post('sign-in', { email: to, password: pass });

  const makeUser = (to: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { email: to, fullName: 'Old Name', passwordHash, emailVerifiedAt: new Date(), ...data },
    });
  const findUser = (to = email) => prisma.user.findUniqueOrThrow({ where: { email: to } });
  const subjectKey = (to: string) => createHash('sha256').update(to).digest('hex');
  const throttleRow = (to = email) => prisma.authThrottle.findFirst({ where: { subjectKey: subjectKey(to) } });
  /** Makes the last sign-up or code look this many seconds older. */
  const age = async (seconds: number, to = email) => {
    const row = (await throttleRow(to))!;
    await prisma.authThrottle.update({
      where: { id: row.id },
      data: { lastSentAt: new Date(row.lastSentAt!.getTime() - seconds * 1000) },
    });
  };
  const lastCode = () => codesSent[codesSent.length - 1].code;
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');
  const sessionCookie = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('agi_sid='));

  const emails = ['new', 'verified', 'unverified', 'ghost'].map((name) => `${name}${domain}`);
  const cleanUp = async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.authThrottle.deleteMany({ where: { subjectKey: { in: emails.map(subjectKey) } } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationCode: (to: EmailRecipient, code: string) => codesSent.push({ to, code }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordService).hash(oldPassword);
  });

  beforeEach(async () => {
    await cleanUp();
    codesSent = [];
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('POST /auth/sign-up', () => {
    it('creates an unverified user without a session and sends one code, stored as a hash', async () => {
      const res = await signUp().expect(201);
      expect(res.body).toEqual({ next: 'verify-email' });
      expect(sessionCookie(res)).toBeUndefined();
      const user = await findUser();
      expect(user).toMatchObject({ fullName: 'New User', emailVerifiedAt: null });
      expect(user.passwordHash).not.toContain(password);
      expect(codesSent).toHaveLength(1);
      expect(codesSent[0].to.email).toBe(email);
      const codes = await prisma.emailVerificationCode.findMany({ where: { userId: user.id } });
      expect(codes).toHaveLength(1);
      expect(codes[0].codeHash).toBe(createHash('sha256').update(`${user.id}:${codesSent[0].code}`).digest('hex'));
    });

    it('trims and lower-cases the email and trims the name', async () => {
      await signUp({ email: `  New${domain.toUpperCase()} `, fullName: '  New User ' }).expect(201);
      expect((await findUser()).fullName).toBe('New User');
    });

    it.each([
      ['verified', {}],
      ['verified and linked to Google', { googleSubject: 'signup-e2e-google' }],
      ['Google-only', { passwordHash: null, googleSubject: 'signup-e2e-google' }],
      ['deactivated', { deactivatedAt: new Date() }],
      ['deactivated before verifying', { deactivatedAt: new Date(), emailVerifiedAt: null }],
    ])('refuses an existing %s account and changes nothing', async (_name, data) => {
      const before = await makeUser(email, data);
      const res = await signUp().expect(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(sessionCookie(res)).toBeUndefined();
      expect(await findUser()).toEqual(before);
      expect(await throttleRow()).toBeNull();
      expect(codesSent).toHaveLength(0);
    });

    it('refuses to sign up again right after the email was verified', async () => {
      await signUp();
      await verify(lastCode()).expect(200);
      expect((await signUp().expect(409)).body.error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(codesSent).toHaveLength(1);
    });

    it('replaces the password and name of an unverified account and sends a new code', async () => {
      const to = `unverified${domain}`;
      const user = await makeUser(to, { emailVerifiedAt: null });
      await prisma.emailVerificationCode.create({
        data: { userId: user.id, codeHash: 'old', expiresAt: new Date(Date.now() + 60_000) },
      });
      const res = await signUp({ email: to }).expect(201);
      expect(res.body).toEqual({ next: 'verify-email' });
      const after = await findUser(to);
      expect(after).toMatchObject({ id: user.id, fullName: 'New User', emailVerifiedAt: null });
      expect(after.passwordHash).not.toBe(passwordHash);
      const old = await prisma.emailVerificationCode.findFirst({ where: { userId: user.id, codeHash: 'old' } });
      expect(old?.voidedAt).not.toBeNull();
      expect(codesSent).toHaveLength(1);
    });

    it('changes and sends nothing when repeated within 60 seconds before verification', async () => {
      await signUp().expect(201);
      const before = await findUser();
      expect((await signUp({ password: 'another horse 3' }).expect(201)).body).toEqual({ next: 'verify-email' });
      expect(await findUser()).toEqual(before);
      expect(codesSent).toHaveLength(1);
    });

    it.each([
      ['a malformed email', { email: 'not-an-email' }],
      ['a name of spaces', { fullName: '   ' }],
      ['a missing name', { fullName: undefined }],
      ['an unknown field', { systemRole: 'super_admin' }],
    ])('rejects %s', async (_name, body) => {
      const res = await signUp(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it.each([
      ['under 8 characters', 'abcd123', ['password must have at least 8 characters']],
      ['over 128 characters', `a1${'x'.repeat(127)}`, ['password must have at most 128 characters']],
      ['no letter', '12345678', ['password must contain a letter']],
      ['no number', 'abcdefgh', ['password must contain a number']],
      ['the email name in another case', 'xxNEWxx12', ['password must not contain the email name']],
      ['two rules', 'abc', ['password must have at least 8 characters', 'password must contain a number']],
    ])('names the broken password rules: %s', async (_name, weak, expected) => {
      const res = await signUp({ password: weak }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect((res.body.error.details as string[]).sort()).toEqual([...expected].sort());
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('requires the CSRF token', async () => {
      for (const [path, body] of [
        ['sign-up', { fullName: 'New User', email, password }],
        ['verify-email', { email, code: '123456', password }],
        ['resend-code', { email }],
      ] as const) {
        const res = await post(path, body, false).expect(403);
        expect(res.body.error.code).toBe('CSRF_INVALID');
      }
    });

    it('creates one user and sends one code for parallel sign-ups', async () => {
      const results = await Promise.all([signUp(), signUp()]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(codesSent).toHaveLength(1);
      await verify(lastCode()).expect(200);
    });

    it('sends one code for parallel sign-ups on an unverified account, and that code works', async () => {
      await makeUser(email, { emailVerifiedAt: null });
      const results = await Promise.all(Array.from({ length: 5 }, () => signUp()));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(codesSent).toHaveLength(1);
      expect(
        await prisma.emailVerificationCode.count({
          where: { userId: (await findUser()).id, consumedAt: null, voidedAt: null },
        }),
      ).toBe(1);
      await verify(lastCode()).expect(200);
    });

    it('changes and sends nothing when Google takes the account over after the lookup', async () => {
      await makeUser(email, { emailVerifiedAt: null });
      const verification = app.get(EmailVerificationService);
      const original = verification.claim.bind(verification);
      jest.spyOn(verification, 'claim').mockImplementationOnce(async (to) => {
        const claimed = await original(to);
        await prisma.user.update({
          where: { email },
          data: { passwordHash: null, googleSubject: 'signup-e2e-google', emailVerifiedAt: new Date() },
        });
        return claimed;
      });
      await signUp().expect(409);
      expect(await findUser()).toMatchObject({ passwordHash: null, fullName: 'Old Name' });
      expect(codesSent).toHaveLength(0);
    });

    it('does not replace the password of an account verified at the last moment', async () => {
      await makeUser(email, { emailVerifiedAt: null });
      const original = prisma.user.findUniqueOrThrow.bind(prisma.user);
      jest.spyOn(prisma.user, 'findUniqueOrThrow').mockImplementationOnce(((args: Parameters<typeof original>[0]) =>
        original(args).then(async (user) => {
          await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
          return user;
        })) as never);
      await signUp().expect(409);
      expect(await findUser()).toMatchObject({ passwordHash, fullName: 'Old Name' });
      expect(codesSent).toHaveLength(0);
    });

    it('still creates the account when a stranger used up the attempts; a resend then works', async () => {
      await resend().expect(200);
      for (let i = 0; i < 5; i++) await verify('000000').expect(400);
      await signUp().expect(201);
      expect(codesSent).toHaveLength(0);
      await age(60);
      await resend().expect(200);
      await verify(lastCode()).expect(200);
    });
  });

  describe('POST /auth/verify-email', () => {
    it('verifies, starts a session and uses the code up', async () => {
      await signUp();
      const res = await verify(lastCode()).expect(200);
      const user = await findUser();
      expect(res.body).toEqual({
        user: { id: user.id, email, fullName: 'New User', systemRole: 'user' },
        next: 'home',
      });
      expect(user.emailVerifiedAt).not.toBeNull();
      const cookie = sessionCookie(res)!;
      expect(cookie).toContain('HttpOnly');
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie.split(';')[0]).expect(200);

      const again = await verify(lastCode()).expect(400);
      expect(again.body.error.code).toBe('INCORRECT_CODE');
    });

    it('blocks the 6th attempt, even with the right code, until a new code is sent', async () => {
      await signUp();
      const first = lastCode();
      for (let i = 0; i < 5; i++) {
        const res = await verify(wrong(first)).expect(400);
        expect(res.body.error.code).toBe('INCORRECT_CODE');
      }
      expect((await verify(first).expect(429)).body.error.code).toBe('CODE_LOCKED');
      await signUp().expect(201);
      expect((await verify(first).expect(429)).body.error.code).toBe('CODE_LOCKED');

      await age(60);
      await resend().expect(200);
      // Only when the random codes differ does the old one prove anything.
      if (lastCode() !== first) await verify(first).expect(400);
      await verify(lastCode()).expect(200);
    });

    it('after signing up again, the old code stops working', async () => {
      await signUp({ password: oldPassword });
      const first = lastCode();
      await age(60);
      await signUp().expect(201);
      if (lastCode() !== first) await verify(first).expect(400);
      await verify(lastCode()).expect(200);
    });

    it('never leaves a stranger with a working password or session', async () => {
      // The stranger signs up first; the owner's sign-up falls inside the cooldown and is ignored.
      await signUp({ password: oldPassword });
      const { id } = await findUser();
      await prisma.userSession.create({ data: { userId: id, tokenHash: hashSessionToken('signup-stranger') } });
      await signUp().expect(201);
      await verify(lastCode(), email, password).expect(200);
      await signIn(oldPassword).expect(401);
      expect((await signIn(password).expect(200)).body.next).toBe('home');
      const open = await prisma.userSession.count({
        where: { tokenHash: hashSessionToken('signup-stranger'), endedAt: null },
      });
      expect(open).toBe(0);
    });

    it('keeps the password of the verification when a sign-up replaces it meanwhile', async () => {
      await signUp();
      const verification = app.get(EmailVerificationService);
      const original = verification.consume.bind(verification);
      const spy = jest.spyOn(verification, 'consume').mockImplementation(async (userId, code) => {
        const ok = await original(userId, code);
        await prisma.user.update({ where: { id: userId }, data: { passwordHash } }); // a stranger's, oldPassword
        return ok;
      });
      await verify(lastCode()).expect(200);
      spy.mockRestore();
      await signIn(oldPassword).expect(401);
      await signIn(password).expect(200);
    });

    it.each([
      ['verified', () => ({ emailVerifiedAt: new Date() })],
      ['deactivated', () => ({ deactivatedAt: new Date() })],
      ['taken over by Google', () => ({ passwordHash: null, googleSubject: 'signup-e2e-google' })],
    ])('gives no session when the account is %s while the code is checked', async (_name, change) => {
      await signUp();
      const { id } = await findUser();
      const verification = app.get(EmailVerificationService);
      const original = verification.consume.bind(verification);
      jest.spyOn(verification, 'consume').mockImplementationOnce(async (userId, code) => {
        const ok = await original(userId, code);
        await prisma.user.update({ where: { id: userId }, data: change() });
        return ok;
      });
      const before = (await findUser()).passwordHash;
      const res = await verify(lastCode(), email, 'fresh horse battery 3').expect(400);
      expect(res.body.error.code).toBe('INCORRECT_CODE');
      expect(sessionCookie(res)).toBeUndefined();
      expect(await prisma.userSession.count({ where: { userId: id } })).toBe(0);
      expect([before, null]).toContain((await findUser()).passwordHash);
    });

    it('rejects a weak password without counting an attempt', async () => {
      await signUp();
      expect((await verify(lastCode(), email, 'abc').expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await throttleRow())?.failedCount).toBe(0);
    });

    it('refuses a code after 10 minutes', async () => {
      await signUp();
      await age(600);
      expect((await verify(lastCode()).expect(400)).body.error.code).toBe('CODE_EXPIRED');
    });

    it('checks at most 5 of 20 parallel guesses', async () => {
      await signUp();
      const guess = wrong(lastCode());
      const results = await Promise.all(Array.from({ length: 20 }, () => verify(guess)));
      expect(results.filter((r) => r.status === 400)).toHaveLength(5);
      expect(results.filter((r) => r.status === 429)).toHaveLength(15);
    });

    it('gives one session for parallel requests with the right code', async () => {
      await signUp();
      const results = await Promise.all([verify(lastCode()), verify(lastCode()), verify(lastCode())]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.userSession.count({ where: { userId: (await findUser()).id } })).toBe(1);
    });

    it('refuses a deactivated account with the right code', async () => {
      await signUp();
      await prisma.user.update({ where: { email }, data: { deactivatedAt: new Date() } });
      const res = await verify(lastCode()).expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
      expect(sessionCookie(res)).toBeUndefined();
    });

    it.each(['12345', '1234567', 'abcdef'])('rejects the malformed code %s', async (code) => {
      expect((await verify(code).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    });

    it('answers the same for a verified account and for an unverified one', async () => {
      const verified = `verified${domain}`;
      await makeUser(verified);
      await makeUser(email, { emailVerifiedAt: null });
      const trace = async (to: string) => {
        const out: unknown[] = [];
        const record = async (req: request.Test) => {
          const res = await req;
          out.push([res.status, res.body]);
        };
        const guess = () => (codesSent.length ? wrong(lastCode()) : '123456');
        await record(verify(guess(), to));
        await record(resend(to));
        await record(resend(to));
        for (let i = 0; i < 6; i++) await record(verify(guess(), to));
        await age(60, to);
        await record(resend(to));
        await record(verify(guess(), to));
        return out;
      };
      expect(await trace(verified)).toEqual(await trace(email));
      expect(codesSent.every((m) => m.to.email === email)).toBe(true);
    });
  });

  describe('POST /auth/resend-code', () => {
    it('refuses within 60 seconds, then sends a new code', async () => {
      await signUp();
      const res = await resend().expect(429);
      expect(res.body.error.code).toBe('RESEND_TOO_SOON');
      await age(60);
      expect((await resend().expect(200)).body).toEqual({ sent: true });
      expect(codesSent).toHaveLength(2);
    });

    it('behaves the same for an email without an account', async () => {
      const ghost = `ghost${domain}`;
      await makeUser(email, { emailVerifiedAt: null });
      for (const to of [ghost, email]) {
        expect((await resend(to).expect(200)).body).toEqual({ sent: true });
        expect((await resend(to).expect(429)).body.error.code).toBe('RESEND_TOO_SOON');
        expect((await verify('000000', to).expect(400)).body.error.code).toBe('INCORRECT_CODE');
      }
      expect(codesSent.every((m) => m.to.email === email)).toBe(true);
    });

    it('sends one code for parallel resends', async () => {
      await signUp();
      await age(60);
      const results = await Promise.all([resend(), resend(), resend()]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(codesSent).toHaveLength(2);
    });
  });

  describe('POST /auth/sign-in for an unverified account', () => {
    it('gives no session and sends a fresh code at most every 60 seconds', async () => {
      const user = await makeUser(email, { emailVerifiedAt: null });
      await signIn('wrong password').expect(401);
      expect(codesSent).toHaveLength(0);

      const res = await signIn(oldPassword).expect(200);
      expect(res.body).toEqual({
        user: { id: user.id, email, fullName: 'Old Name', systemRole: 'user' },
        next: 'verify-email',
      });
      expect(sessionCookie(res)).toBeUndefined();
      expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
      await Promise.all(Array.from({ length: 3 }, () => signIn(oldPassword).expect(200)));
      expect(codesSent).toHaveLength(1);
      await verify(lastCode()).expect(200);
    });
  });
});
