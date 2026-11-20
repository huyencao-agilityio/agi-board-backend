import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { CurrentUser } from '../src/common/decorators/current-user.decorator';
import { RequireSystemRole } from '../src/common/decorators/require-system-role.decorator';
import type { SessionUser } from '../src/common/guards/session.guard';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';

class EchoDto {
  @IsString()
  text!: string;
}

/** Test-only routes that exercise the global guards, pipe and filter. */
@Controller('probe')
class ProbeController {
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { id: user.id };
  }

  @Post('echo')
  echo(@Body() body: EchoDto) {
    return body;
  }

  @RequireSystemRole('support', 'super_admin')
  @Get('admin')
  admin() {
    return { ok: true };
  }
}

describe('App (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const csrf = 'test-csrf-token';
  const csrfCookie = `csrf_token=${csrf}`;

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
    await prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await app.close();
  });

  /** Creates a user with a live session and returns the session cookie. */
  async function signedIn(data: { systemRole?: 'user' | 'support'; deactivatedAt?: Date } = {}) {
    const token = newSessionToken();
    await prisma.user.create({
      data: {
        email: `${token.slice(0, 8).toLowerCase()}@e2e.test`,
        fullName: 'E2E User',
        passwordHash: 'not-a-real-hash',
        ...data,
        sessions: { create: { tokenHash: hashSessionToken(token) } },
      },
    });
    return `agi_sid=${token}`;
  }

  describe('health', () => {
    it('GET /health is public', () => request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' }));

    it('GET /health/db reaches the database', () =>
      request(app.getHttpServer()).get('/api/v1/health/db').expect(200, { status: 'ok' }));
  });

  describe('errors', () => {
    it('unknown route returns the error envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/nope')
        .set('Cookie', await signedIn())
        .expect(404);
      expect(res.body).toEqual({ error: expect.objectContaining({ code: 'NOT_FOUND' }) });
    });

    it('validation failures list the details', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe/echo')
        .set('Cookie', [csrfCookie, await signedIn()])
        .set('X-CSRF-Token', csrf)
        .send({ text: 1, extra: true })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toHaveLength(2);
    });
  });

  describe('CSRF', () => {
    it('issues a csrf_token cookie on safe requests', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^csrf_token=/);
    });

    it('rejects a write without the header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe/echo')
        .set('Cookie', [csrfCookie, await signedIn()])
        .send({ text: 'hi' })
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });

    it('rejects a header that does not match the cookie', () =>
      request(app.getHttpServer())
        .post('/api/v1/probe/echo')
        .set('Cookie', csrfCookie)
        .set('X-CSRF-Token', 'other')
        .expect(403));

    it('accepts a matching cookie and header', async () =>
      request(app.getHttpServer())
        .post('/api/v1/probe/echo')
        .set('Cookie', [csrfCookie, await signedIn()])
        .set('X-CSRF-Token', csrf)
        .send({ text: 'hi' })
        .expect(201, { text: 'hi' }));
  });

  describe('session', () => {
    it('rejects requests without a session cookie', () =>
      request(app.getHttpServer()).get('/api/v1/probe/me').expect(401));

    it('rejects an unknown token', () =>
      request(app.getHttpServer()).get('/api/v1/probe/me').set('Cookie', 'agi_sid=unknown').expect(401));

    it('accepts a live session', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/me')
        .set('Cookie', await signedIn())
        .expect(200);
      expect(res.body.id).toEqual(expect.any(String));
    });

    it('rejects a deactivated user', async () =>
      request(app.getHttpServer())
        .get('/api/v1/probe/me')
        .set('Cookie', await signedIn({ deactivatedAt: new Date() }))
        .expect(401));

    it('enforces @RequireSystemRole', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/probe/admin')
        .set('Cookie', await signedIn())
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/probe/admin')
        .set('Cookie', await signedIn({ systemRole: 'support' }))
        .expect(200);
    });
  });
});
