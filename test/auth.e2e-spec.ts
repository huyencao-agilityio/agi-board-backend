import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/modules/auth/password.service';

jest.setTimeout(60_000);

describe('Auth sign-in (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let passwordHash: string;
  const csrf = 'test-csrf-token';
  const password = 'correct horse battery staple';

  const signIn = (body: unknown, withCsrf = true) => {
    const req = request(app.getHttpServer()).post('/api/v1/auth/sign-in').set('Cookie', `csrf_token=${csrf}`);
    return (withCsrf ? req.set('X-CSRF-Token', csrf) : req).send(body as object);
  };

  const makeUser = (email: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { email, fullName: 'E2E User', passwordHash, emailVerifiedAt: new Date(), ...data },
    });

  const openSession = (userId: string, token: string) =>
    prisma.userSession.create({ data: { userId, tokenHash: hashSessionToken(token) } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    passwordHash = await passwords.hash(password);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@auth.e2e.test' } } });
    await prisma.authThrottle.deleteMany({});
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@auth.e2e.test' } } });
    await prisma.authThrottle.deleteMany({});
    await app.close();
  });

  describe('POST /auth/sign-in', () => {
    it('signs a verified user in and sets a session cookie', async () => {
      const user = await makeUser('ok@auth.e2e.test');
      const res = await signIn({ email: 'ok@auth.e2e.test', password }).expect(200);

      expect(res.body).toEqual({
        user: { id: user.id, email: 'ok@auth.e2e.test', fullName: 'E2E User', systemRole: 'user' },
        next: 'home',
      });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('agi_sid='))!;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSignInAt).not.toBeNull();
    });

    it('stores only the hash of the cookie token in a live session', async () => {
      await makeUser('hash@auth.e2e.test');
      const res = await signIn({ email: 'hash@auth.e2e.test', password }).expect(200);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('agi_sid='))!;
      const token = cookie.split(';')[0].split('=')[1];
      const session = await prisma.userSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
      expect(session?.endedAt).toBeNull();
      expect(await prisma.userSession.count({ where: { tokenHash: token } })).toBe(0);
    });

    it('answers 200 with next verify-email and no session for an unverified user', async () => {
      const user = await makeUser('unverified@auth.e2e.test', { emailVerifiedAt: null });
      const res = await signIn({ email: 'unverified@auth.e2e.test', password }).expect(200);
      expect(res.body.next).toBe('verify-email');
      expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
    });

    it('answers identically for a wrong password, an unknown email and a Google-only account', async () => {
      await makeUser('known@auth.e2e.test');
      await makeUser('google@auth.e2e.test', { passwordHash: null, googleSubject: 'e2e-google-sub' });
      const results = await Promise.all([
        signIn({ email: 'known@auth.e2e.test', password: 'wrong password' }),
        signIn({ email: 'nobody@auth.e2e.test', password: 'wrong password' }),
        signIn({ email: 'google@auth.e2e.test', password: 'wrong password' }),
      ]);
      for (const res of results) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual(results[0].body);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('refuses a deactivated account with the right password, but hides it behind a wrong one', async () => {
      await makeUser('off@auth.e2e.test', { deactivatedAt: new Date() });
      const right = await signIn({ email: 'off@auth.e2e.test', password }).expect(403);
      expect(right.body.error.code).toBe('ACCOUNT_DEACTIVATED');
      const wrong = await signIn({ email: 'off@auth.e2e.test', password: 'wrong password' }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('does not keep counting failures once the correct password was given, even for a deactivated account', async () => {
      await makeUser('off2@auth.e2e.test', { deactivatedAt: new Date() });
      for (let i = 0; i < 3; i++) await signIn({ email: 'off2@auth.e2e.test', password: 'wrong password' }).expect(401);
      await signIn({ email: 'off2@auth.e2e.test', password }).expect(403);
      expect(await prisma.authThrottle.count()).toBe(0);
    });

    it('locks after 5 wrong passwords, also for an unknown email, without counting the locked attempt', async () => {
      await makeUser('lock@auth.e2e.test');
      for (const email of ['lock@auth.e2e.test', 'ghost@auth.e2e.test']) {
        for (let i = 0; i < 5; i++) await signIn({ email, password: 'wrong password' }).expect(401);
        const locked = await signIn({ email, password: 'wrong password' }).expect(429);
        expect(locked.body.error.code).toBe('SIGN_IN_LOCKED');
      }
      const rows = await prisma.authThrottle.findMany({ where: { scope: 'sign_in' } });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.lockedUntil).not.toBeNull();
    });

    it('rejects the correct password while locked', async () => {
      await makeUser('locked@auth.e2e.test');
      for (let i = 0; i < 5; i++) await signIn({ email: 'locked@auth.e2e.test', password: 'wrong password' });
      const res = await signIn({ email: 'locked@auth.e2e.test', password }).expect(429);
      expect(res.body.error.code).toBe('SIGN_IN_LOCKED');
    });

    it('verifies at most 5 passwords when many wrong attempts arrive at once', async () => {
      await makeUser('race@auth.e2e.test');
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => signIn({ email: 'race@auth.e2e.test', password: `wrong password ${i}` })),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(15);
      const res = await signIn({ email: 'race@auth.e2e.test', password }).expect(429);
      expect(res.body.error.code).toBe('SIGN_IN_LOCKED');
      expect(await prisma.authThrottle.count()).toBe(1);
    });

    it('clears the failure count after a successful sign-in', async () => {
      await makeUser('clear@auth.e2e.test');
      for (let i = 0; i < 4; i++) await signIn({ email: 'clear@auth.e2e.test', password: 'wrong password' });
      await signIn({ email: 'clear@auth.e2e.test', password }).expect(200);
      expect(await prisma.authThrottle.count()).toBe(0);
    });

    it('requires the CSRF token', async () => {
      const res = await signIn({ email: 'csrf@auth.e2e.test', password }, false).expect(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });
  });

  describe('GET /auth/me', () => {
    const cookieOf = (res: request.Response) =>
      (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('agi_sid='))!.split(';')[0];

    it('answers 401 without a session', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('returns the signed-in user in the same shape as sign-in, without secrets', async () => {
      const user = await makeUser('me@auth.e2e.test');
      const cookie = cookieOf(await signIn({ email: 'me@auth.e2e.test', password }).expect(200));
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      expect(res.body).toEqual({
        user: { id: user.id, email: 'me@auth.e2e.test', fullName: 'E2E User', systemRole: 'user' },
        next: 'home',
      });
    });

    it('says verify-email for a user whose email is not verified yet', async () => {
      const user = await makeUser('me2@auth.e2e.test', { emailVerifiedAt: null });
      await openSession(user.id, 'me2-token');
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', 'agi_sid=me2-token')
        .expect(200);
      expect(res.body.next).toBe('verify-email');
    });
  });

  describe('Email format', () => {
    it.each([
      ['a malformed email', 'not-an-email'],
      ['an email over 254 characters', `${'a'.repeat(250)}@auth.e2e.test`],
    ])('rejects %s with VALIDATION_FAILED', async (_name, email) => {
      const res = await signIn({ email, password }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a missing password and unknown fields', async () => {
      expect((await signIn({ email: 'a@auth.e2e.test' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await signIn({ email: 'a@auth.e2e.test', password, extra: 1 }).expect(400)).body.error.code).toBe(
        'VALIDATION_FAILED',
      );
    });

    it('trims and lower-cases the email before looking the account up', async () => {
      await makeUser('mixed@auth.e2e.test');
      await signIn({ email: '  Mixed@Auth.E2E.test ', password }).expect(200);
    });

    it('does not restrict the email domain', async () => {
      await makeUser('person@example.org');
      await signIn({ email: 'person@example.org', password }).expect(200);
      await prisma.user.deleteMany({ where: { email: 'person@example.org' } });
    });
  });

  describe('Google sign-in', () => {
    const origin = 'http://localhost:5173';
    const realFetch = global.fetch;
    let nextIdToken: string | undefined;
    let tokenStatus = 200;

    const idToken = (claims: Record<string, unknown>) =>
      `h.${Buffer.from(
        JSON.stringify({
          iss: 'https://accounts.google.com',
          aud: 'e2e-client',
          exp: Math.floor(Date.now() / 1000) + 3600,
          email_verified: true,
          sub: 'google-e2e-sub',
          email: 'g@auth.e2e.test',
          name: 'Google User',
          ...claims,
        }),
      ).toString('base64url')}.s`;

    /** Starts the flow like a browser: returns the state cookie and the state Google would echo back. */
    const start = async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/google').expect(302);
      const location = new URL(res.headers.location);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('agi_oauth='))!;
      return { location, state: location.searchParams.get('state')!, cookie: cookie.split(';')[0] };
    };

    /** The callback always answers with a redirect to the frontend. */
    const callback = async (query: Record<string, string>, opts: { state?: string } = {}) => {
      const flow = await start();
      const params = new URLSearchParams({ state: opts.state ?? flow.state, ...query });
      const res = await request(app.getHttpServer())
        .get(`/api/v1/auth/google/callback?${params.toString()}`)
        .set('Cookie', flow.cookie);
      expect(res.status).toBe(302);
      return res;
    };

    const sessionCookie = (res: request.Response) =>
      (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('agi_sid='));

    beforeEach(() => {
      tokenStatus = 200;
      nextIdToken = idToken({});
      // Only Google's token endpoint is faked; Miniflare's D1 proxy goes through other code paths.
      jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          return Promise.resolve(
            new Response(JSON.stringify({ id_token: nextIdToken }), {
              status: tokenStatus,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return realFetch(input, init);
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it('redirects to Google with state and PKCE, and sets a state cookie', async () => {
      const { location, cookie } = await start();
      expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location.searchParams.get('client_id')).toBe('e2e-client');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(cookie).toMatch(/^agi_oauth=.+/);
    });

    it('creates a user on the first Google sign-in and goes to /home with a session cookie', async () => {
      const res = await callback({ code: 'c' });
      expect(res.headers.location).toBe(`${origin}/home`);
      expect(sessionCookie(res)).toContain('HttpOnly');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'g@auth.e2e.test' } });
      expect(user).toMatchObject({ passwordHash: null, googleSubject: 'google-e2e-sub', fullName: 'Google User' });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(1);
      expect(await prisma.emailVerificationCode.count({ where: { userId: user.id } })).toBe(0);
    });

    it('merges into a verified password account with the same email, silently, and keeps its password', async () => {
      const existing = await makeUser('g@auth.e2e.test');
      const res = await callback({ code: 'c' });
      expect(res.headers.location).toBe(`${origin}/home`);
      expect(await prisma.user.count({ where: { email: 'g@auth.e2e.test' } })).toBe(1);
      const merged = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      expect(merged.googleSubject).toBe('google-e2e-sub');
      expect(merged.passwordHash).toBe(passwordHash);
    });

    it('drops the password and ends the sessions of an unverified account when Google links to it', async () => {
      // Someone may have registered this email without proving they own it; only the Google owner keeps access.
      const existing = await makeUser('g@auth.e2e.test', { emailVerifiedAt: null });
      await openSession(existing.id, 'pre-hijack-token');
      const res = await callback({ code: 'c' });
      expect(res.headers.location).toBe(`${origin}/home`);
      const merged = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      expect(merged).toMatchObject({ googleSubject: 'google-e2e-sub', passwordHash: null });
      expect(merged.emailVerifiedAt).not.toBeNull();
      const sessions = await prisma.userSession.findMany({ where: { userId: existing.id } });
      expect(sessions.filter((s) => s.endedAt === null)).toHaveLength(1); // only the new Google session
      expect(sessions.filter((s) => s.endReason === 'password_reset')).toHaveLength(1);
      await signIn({ email: 'g@auth.e2e.test', password }).expect(401);
    });

    it('accepts an account of any email domain', async () => {
      nextIdToken = idToken({ email: 'someone@gmail.com', sub: 'other-sub' });
      const res = await callback({ code: 'c' });
      expect(res.headers.location).toBe(`${origin}/home`);
      await prisma.user.deleteMany({ where: { email: 'someone@gmail.com' } });
    });

    it('goes back to /sign-in with no message and no session when the user declines', async () => {
      const res = await callback({ error: 'access_denied' });
      expect(res.headers.location).toBe(`${origin}/sign-in`);
      expect(sessionCookie(res)).toBeUndefined();
    });

    it.each([
      ['a state that does not match', { state: 'forged' }, undefined],
      ['a failed token exchange', {}, 400],
      ['an invalid id_token', {}, 'bad'],
    ])('redirects with google_failed for %s', async (_name, opts, tweak) => {
      if (tweak === 400) tokenStatus = 400;
      if (tweak === 'bad') nextIdToken = idToken({ aud: 'someone-else' });
      const res = await callback({ code: 'c' }, opts);
      expect(res.headers.location).toBe(`${origin}/sign-in?error=google_failed`);
      expect(sessionCookie(res)).toBeUndefined();
      expect(await prisma.user.count({ where: { email: 'g@auth.e2e.test' } })).toBe(0);
    });

    it('redirects with account_deactivated for a deactivated user, with no session', async () => {
      await makeUser('g@auth.e2e.test', { deactivatedAt: new Date() });
      const res = await callback({ code: 'c' });
      expect(res.headers.location).toBe(`${origin}/sign-in?error=account_deactivated`);
      expect(sessionCookie(res)).toBeUndefined();
    });

    it('clears the state cookie on every outcome', async () => {
      const res = await callback({ error: 'access_denied' });
      const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('agi_oauth='));
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    });
  });
});
