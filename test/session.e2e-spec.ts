import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import type { SessionEndReason } from '../src/generated/prisma/enums';

/** Test-only route behind SessionGuard. */
@Controller('probe')
class ProbeController {
  @Get('me')
  me() {
    return { ok: true };
  }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('Session lifetime and ended sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@session.e2e.test' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@session.e2e.test' } } });
    await app.close();
  });

  /** Creates a user with one session and returns its cookie and id. */
  const makeSession = async (opts: { endReason?: SessionEndReason; idleMs?: number } = {}) => {
    const token = newSessionToken();
    const user = await prisma.user.create({
      data: {
        email: `${token.slice(0, 8).toLowerCase()}@session.e2e.test`,
        fullName: 'Session User',
        googleSubject: `sub-${token}`,
        sessions: {
          create: {
            tokenHash: hashSessionToken(token),
            lastActiveAt: new Date(Date.now() - (opts.idleMs ?? 0)),
            ...(opts.endReason ? { endedAt: new Date(), endReason: opts.endReason } : {}),
          },
        },
      },
      select: { sessions: { select: { id: true } } },
    });
    return { cookie: `agi_sid=${token}`, sessionId: user.sessions[0].id };
  };

  const me = (cookie?: string) => {
    const req = request(app.getHttpServer()).get('/api/v1/probe/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it.each(['signed_out_by_admin', 'signed_out_by_user', 'password_changed', 'password_reset'] as const)(
    'answers SESSION_ENDED for a session ended with %s',
    async (endReason) => {
      const { cookie } = await makeSession({ endReason });
      const res = await me(cookie).expect(401);
      expect(res.body.error.code).toBe('SESSION_ENDED');
    },
  );

  it('answers a plain 401 after a normal logout, so no notice is shown', async () => {
    const { cookie } = await makeSession({ endReason: 'logout' });
    const res = await me(cookie).expect(401);
    expect(res.body.error.code).not.toBe('SESSION_ENDED');
  });

  it('answers a plain 401 without a cookie or with an unknown token', async () => {
    expect((await me().expect(401)).body.error.code).not.toBe('SESSION_ENDED');
    expect((await me('agi_sid=unknown').expect(401)).body.error.code).not.toBe('SESSION_ENDED');
  });

  it('ends a session idle for more than 7 days with reason expired', async () => {
    const { cookie, sessionId } = await makeSession({ idleMs: 7 * DAY + HOUR });
    const res = await me(cookie).expect(401);
    expect(res.body.error.code).toBe('SESSION_ENDED');
    const row = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.endReason).toBe('expired');
    expect(row.endedAt).not.toBeNull();
    // The next request sees an ended session, still with the notice.
    expect((await me(cookie).expect(401)).body.error.code).toBe('SESSION_ENDED');
  });

  it('refreshes last_active_at and the cookie when the session is more than an hour old', async () => {
    const { cookie, sessionId } = await makeSession({ idleMs: 2 * HOUR });
    const before = Date.now();
    const res = await me(cookie).expect(200);
    const row = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const renewed = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('agi_sid='));
    expect(renewed).toContain('HttpOnly');
  });

  it('does not touch a session used in the last hour', async () => {
    const { cookie, sessionId } = await makeSession({ idleMs: 10 * 60 * 1000 });
    const before = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    const res = await me(cookie).expect(200);
    const after = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.lastActiveAt).toEqual(before.lastActiveAt);
    expect(res.headers['set-cookie']?.toString() ?? '').not.toContain('agi_sid=');
  });
});
