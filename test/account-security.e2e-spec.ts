import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/modules/auth/password/password.service';
import { throttleKey } from '../src/modules/auth/throttle-key';

jest.setTimeout(60_000);

const DOMAIN = '@account.e2e.test';
const DAY = 24 * 60 * 60 * 1000;

describe('Change password and active sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwordHash: string;
  let idleDays: number;
  const csrf = 'test-csrf-token';
  const csrfCookie = `csrf_token=${csrf}`;
  const password = 'old-password-1';
  const newPassword = 'new-password-2';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await app.get(PasswordService).hash(password);
    idleDays = app.get(ConfigService).get<number>('SESSION_IDLE_DAYS')!;
  });

  async function cleanUp() {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    for (const { id } of users) await prisma.authThrottle.deleteMany({ where: throttleKey('change_password', id) });
    // Audit rows reference their actor (no cascade), so they go first.
    await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  }

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const makeUser = (name: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { email: `${name}${DOMAIN}`, fullName: 'Account User', passwordHash, emailVerifiedAt: new Date(), ...data },
      select: { id: true, email: true },
    });

  /** A real sign-in; returns the session cookie. */
  async function signIn(email: string, pass = password) {
    const res = await http()
      .post('/api/v1/auth/sign-in')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrf)
      .send({ email, password: pass });
    const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith('agi_sid='),
    );
    return { status: res.status, cookie: cookie?.split(';')[0] };
  }

  /** A session row without the password hash cost; returns its id and cookie. */
  async function openSession(userId: string, data: { lastActiveAt?: Date; endedAt?: Date } = {}) {
    const token = newSessionToken();
    const session = await prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        userAgent: 'TestAgent/1.0',
        ipAddress: '10.0.0.1',
        ...data,
        ...(data.endedAt ? { endReason: 'logout' as const } : {}),
      },
      select: { id: true },
    });
    return { id: session.id, cookie: `agi_sid=${token}` };
  }

  const me = (cookie: string) => http().get('/api/v1/auth/me').set('Cookie', cookie);

  /** The user's audit rows as `[action, data]`, after checking the fields every self-service row shares. */
  async function audits(userId: string) {
    const rows = await prisma.auditLogEntry.findMany({ where: { actorId: userId }, orderBy: { createdAt: 'asc' } });
    for (const row of rows) {
      expect(row).toMatchObject({
        workspaceId: null,
        targetId: userId,
        targetType: 'user',
        actorName: 'Account User',
        targetLabel: 'Account User',
      });
    }
    return rows.map((r) => [r.action, typeof r.data === 'string' ? (JSON.parse(r.data) as unknown) : r.data]);
  }

  describe('POST /auth/change-password', () => {
    const change = (cookie: string | null, body: unknown, withCsrf = true) => {
      const req = http()
        .post('/api/v1/auth/change-password')
        .set('Cookie', cookie ? [cookie, csrfCookie] : [csrfCookie]);
      return (withCsrf ? req.set('X-CSRF-Token', csrf) : req).send(body as object);
    };

    it('replaces the password, ends the other sessions and keeps this one', async () => {
      const user = await makeUser('happy');
      const a = await signIn(user.email);
      const b = await signIn(user.email);
      await change(a.cookie!, { currentPassword: password, newPassword }).expect(204);

      const ended = await me(b.cookie!).expect(401);
      expect(ended.body.error.code).toBe('SESSION_ENDED');
      await me(a.cookie!).expect(200);
      const reasons = await prisma.userSession.findMany({
        where: { userId: user.id, endedAt: { not: null } },
        select: { endReason: true },
      });
      expect(reasons).toEqual([{ endReason: 'password_changed' }]);
      expect((await signIn(user.email)).status).toBe(401);
      expect((await signIn(user.email, newPassword)).status).toBe(200);
      expect(await audits(user.id)).toEqual([['password_changed', {}]]);
    });

    it('400 CURRENT_PASSWORD_INCORRECT for a wrong current password; nothing changes', async () => {
      const user = await makeUser('wrong');
      const a = await signIn(user.email);
      const b = await signIn(user.email);
      const res = await change(a.cookie!, { currentPassword: 'nope-1234', newPassword }).expect(400);
      expect(res.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(passwordHash);
      await me(b.cookie!).expect(200);
      expect(await audits(user.id)).toEqual([]);
    });

    it('429 CHANGE_PASSWORD_LOCKED after 5 wrong tries; sign-in still works', async () => {
      const user = await makeUser('locked');
      const a = await signIn(user.email);
      for (let i = 0; i < 5; i++) {
        await change(a.cookie!, { currentPassword: `wrong-${i}a`, newPassword }).expect(400);
      }
      const res = await change(a.cookie!, { currentPassword: password, newPassword }).expect(429);
      expect(res.body.error.code).toBe('CHANGE_PASSWORD_LOCKED');
      expect((await signIn(user.email)).status).toBe(200);
    });

    it('voids a reset link issued before the change', async () => {
      const user = await makeUser('resetlink');
      const a = await signIn(user.email);
      const token = newSessionToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
      await change(a.cookie!, { currentPassword: password, newPassword }).expect(204);
      const res = await http()
        .post('/api/v1/auth/reset-password')
        .set('Cookie', csrfCookie)
        .set('X-CSRF-Token', csrf)
        .send({ token, password: 'attacker-pass-9' })
        .expect(400);
      expect(res.body.error.code).toBe('RESET_LINK_INVALID');
      expect((await signIn(user.email, newPassword)).status).toBe(200);
    });

    it('writes no audit row when the password is replaced between the check and the batch', async () => {
      const user = await makeUser('lostrace');
      const a = await signIn(user.email);
      const passwords = app.get(PasswordService);
      const hash = passwords.hash.bind(passwords);
      // Runs after the current password was verified, before the batch: the batch's guard must see the change.
      jest.spyOn(passwords, 'hash').mockImplementationOnce(async (p) => {
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'replaced' } });
        return hash(p);
      });
      const res = await change(a.cookie!, { currentPassword: password, newPassword }).expect(400);
      expect(res.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
      expect(await audits(user.id)).toEqual([]);
      jest.restoreAllMocks();
    });

    it('a change racing a reset: only the request that won writes an audit row', async () => {
      const user = await makeUser('race');
      const a = await signIn(user.email);
      const token = newSessionToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
      const [changed, reset] = await Promise.all([
        change(a.cookie!, { currentPassword: password, newPassword }),
        http()
          .post('/api/v1/auth/reset-password')
          .set('Cookie', csrfCookie)
          .set('X-CSRF-Token', csrf)
          .send({ token, password: 'reset-pass-77' }),
      ]);
      const expected = [
        ...(changed.status === 204 ? [['password_changed', {}]] : []),
        ...(reset.status < 300 ? [['password_reset_completed', {}]] : []),
      ];
      expect(expected).toHaveLength(1); // one wins: a change voids the link, a reset replaces the verified hash
      expect(await audits(user.id)).toEqual(expected);
    });

    it('400 VALIDATION_FAILED with the broken rules for weak new passwords, never 429 with the right current one', async () => {
      const user = await makeUser('weak');
      const a = await signIn(user.email);
      // Six tries: a right current password must not count toward the 5-failure lock.
      for (const weak of ['short1', 'nonumberhere', 'weak12345678', 'short2', 'nonumberatall', 'weak87654321']) {
        const res = await change(a.cookie!, { currentPassword: password, newPassword: weak }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details.length).toBeGreaterThan(0);
      }
    });

    it('400 VALIDATION_FAILED when the new password is the current one; nothing changes', async () => {
      const user = await makeUser('same');
      const a = await signIn(user.email);
      const b = await signIn(user.email);
      const res = await change(a.cookie!, { currentPassword: password, newPassword: password }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(['password must differ from the current password']);
      await me(b.cookie!).expect(200);
    });

    it('400 PASSWORD_NOT_SET for a Google-only account', async () => {
      const user = await makeUser('google', { passwordHash: null, googleSubject: `g-${Date.now()}` });
      const { cookie } = await openSession(user.id);
      const res = await change(cookie, { currentPassword: password, newPassword }).expect(400);
      expect(res.body.error.code).toBe('PASSWORD_NOT_SET');
    });

    it.each([
      ['missing fields', {}],
      ['an unknown field', { currentPassword: password, newPassword, userId: 'x' }],
    ])('400 VALIDATION_FAILED for %s', async (_case, body) => {
      const user = await makeUser(`invalid${Object.keys(body).length}`);
      const { cookie } = await openSession(user.id);
      const res = await change(cookie, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('401 without a session and 403 without CSRF', async () => {
      await change(null, { currentPassword: password, newPassword }).expect(401);
      const user = await makeUser('csrf');
      const { cookie } = await openSession(user.id);
      const res = await change(cookie, { currentPassword: password, newPassword }, false).expect(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });
  });

  describe('active sessions', () => {
    const del = (cookie: string | null, path: string, withCsrf = true) => {
      const req = http()
        .delete(`/api/v1/auth/sessions${path}`)
        .set('Cookie', cookie ? [cookie, csrfCookie] : [csrfCookie]);
      return withCsrf ? req.set('X-CSRF-Token', csrf) : req;
    };

    it('GET lists only live sessions of the user, newest first, current marked, no IP', async () => {
      const user = await makeUser('list');
      const other = await makeUser('list-other');
      const older = await openSession(user.id, { lastActiveAt: new Date(Date.now() - 2 * DAY) });
      const current = await openSession(user.id);
      await openSession(user.id, { endedAt: new Date() });
      await openSession(user.id, { lastActiveAt: new Date(Date.now() - (idleDays + 1) * DAY) });
      await openSession(other.id);

      const res = await http().get('/api/v1/auth/sessions').set('Cookie', current.cookie).expect(200);
      const items = res.body.items as Record<string, unknown>[];
      expect(items.map((s) => [s.id, s.isCurrent])).toEqual([
        [current.id, true],
        [older.id, false],
      ]);
      expect(Object.keys(items[0]).sort()).toEqual(['createdAt', 'id', 'isCurrent', 'lastActiveAt', 'userAgent']);
      expect(items[0].userAgent).toBe('TestAgent/1.0');
    });

    it('GET 401 without a session', async () => {
      await http().get('/api/v1/auth/sessions').expect(401);
    });

    it('DELETE /:id ends that session only', async () => {
      const user = await makeUser('one');
      const current = await openSession(user.id);
      // Active a day ago: inside the idle window, so still live (checks the raw SQL date comparison).
      const target = await openSession(user.id, { lastActiveAt: new Date(Date.now() - DAY) });
      await del(current.cookie, `/${target.id}`).expect(204);
      const res = await me(target.cookie).expect(401);
      expect(res.body.error.code).toBe('SESSION_ENDED');
      await me(current.cookie).expect(200);
      const row = await prisma.userSession.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.endReason).toBe('signed_out_by_user');
      expect(await audits(user.id)).toEqual([['session_signed_out', { sessionId: target.id }]]);
    });

    it('DELETE /:id with the own session is 400 CURRENT_SESSION', async () => {
      const user = await makeUser('own');
      const current = await openSession(user.id);
      const res = await del(current.cookie, `/${current.id}`).expect(400);
      expect(res.body.error.code).toBe('CURRENT_SESSION');
      expect(await audits(user.id)).toEqual([]);
    });

    it("DELETE /:id is 404 for another user's, an ended, an idle or an unknown session", async () => {
      const user = await makeUser('notfound');
      const other = await makeUser('notfound-other');
      const current = await openSession(user.id);
      const theirs = await openSession(other.id);
      const ended = await openSession(user.id, { endedAt: new Date() });
      const idle = await openSession(user.id, { lastActiveAt: new Date(Date.now() - (idleDays + 1) * DAY) });
      for (const id of [theirs.id, ended.id, idle.id, '0193a000-0000-7000-8000-000000000000']) {
        const res = await del(current.cookie, `/${id}`).expect(404);
        expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
      }
      await me(theirs.cookie).expect(200);
      expect(await audits(user.id)).toEqual([]);
    });

    it('DELETE /:id with a non-UUID is 400 VALIDATION_FAILED', async () => {
      const user = await makeUser('baduuid');
      const current = await openSession(user.id);
      const res = await del(current.cookie, '/not-a-uuid').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('DELETE / ends all other sessions and keeps this one; 204 again when none are left', async () => {
      const user = await makeUser('all');
      const current = await openSession(user.id);
      const b = await openSession(user.id);
      const c = await openSession(user.id);
      await del(current.cookie, '').expect(204);
      await me(b.cookie).expect(401);
      await me(c.cookie).expect(401);
      await me(current.cookie).expect(200);
      expect(await audits(user.id)).toEqual([['other_sessions_signed_out', {}]]);
      await del(current.cookie, '').expect(204);
      expect(await audits(user.id)).toHaveLength(1); // nothing ended the second time, so no row
    });

    it('DELETE routes: 401 without a session, 403 without CSRF', async () => {
      await del(null, '').expect(401);
      await del(null, '/0193a000-0000-7000-8000-000000000000').expect(401);
      const user = await makeUser('sess-csrf');
      const current = await openSession(user.id);
      const target = await openSession(user.id);
      expect((await del(current.cookie, '', false).expect(403)).body.error.code).toBe('CSRF_INVALID');
      expect((await del(current.cookie, `/${target.id}`, false).expect(403)).body.error.code).toBe('CSRF_INVALID');
    });
  });
});
