import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { getBindings } from '../src/cloudflare';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';

const DOMAIN = '@profile.e2e.test';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 4, 5, 6]);

/** Collects a binary response into a Buffer. */
const binary = (res: unknown, done: (err: Error | null, body: unknown) => void) => {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const csrf = 'test-csrf-token';
  const csrfCookie = `csrf_token=${csrf}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  /** Deletes this file's users and their avatar objects (R2 is not cleaned by the database cascade). */
  async function cleanUp() {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: DOMAIN } },
      select: { avatarObjectKey: true },
    });
    for (const { avatarObjectKey } of users) if (avatarObjectKey) await getBindings().IMAGES.delete(avatarObjectKey);
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  }

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  /** Creates a user with a live session; returns its id and the cookies a write needs. */
  async function signedIn(data: { passwordHash?: string | null; googleSubject?: string } = {}) {
    const token = newSessionToken();
    const user = await prisma.user.create({
      data: {
        email: `${token.slice(0, 8).toLowerCase()}${DOMAIN}`,
        fullName: 'Profile User',
        passwordHash: 'not-a-real-hash',
        ...data,
        sessions: { create: { tokenHash: hashSessionToken(token) } },
      },
      select: { id: true, email: true },
    });
    return { ...user, cookie: `agi_sid=${token}`, writeCookies: [`agi_sid=${token}`, csrfCookie] };
  }

  const http = () => request(app.getHttpServer());

  describe('GET /users/me', () => {
    it('returns the profile of a password account', async () => {
      const user = await signedIn();
      const res = await http().get('/api/v1/users/me').set('Cookie', user.cookie).expect(200);
      expect(res.body).toEqual({
        id: user.id,
        email: user.email,
        fullName: 'Profile User',
        avatarUrl: null,
        hasPassword: true,
        googleLinked: false,
      });
    });

    it('marks a Google-only account', async () => {
      const user = await signedIn({ passwordHash: null, googleSubject: `g-${Date.now()}` });
      const res = await http().get('/api/v1/users/me').set('Cookie', user.cookie).expect(200);
      expect(res.body).toMatchObject({ hasPassword: false, googleLinked: true });
    });

    it('401 without a session', async () => {
      await http().get('/api/v1/users/me').expect(401);
    });
  });

  describe('PATCH /users/me', () => {
    const patch = (cookies: string[], body: unknown) =>
      http()
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .send(body as object);

    it('trims and saves the name, visible in /auth/me', async () => {
      const user = await signedIn();
      const res = await patch(user.writeCookies, { fullName: '  New Name  ' }).expect(200);
      expect(res.body.fullName).toBe('New Name');
      const me = await http().get('/api/v1/auth/me').set('Cookie', user.cookie).expect(200);
      expect(me.body.user.fullName).toBe('New Name');
    });

    it.each([
      ['blank', { fullName: '   ' }],
      ['missing', {}],
      ['not a string', { fullName: 42 }],
      ['unknown field', { fullName: 'Ok', email: 'x@example.com' }],
    ])('400 VALIDATION_FAILED when %s', async (_case, body) => {
      const user = await signedIn();
      const res = await patch(user.writeCookies, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('401 without a session', async () => {
      await patch([csrfCookie], { fullName: 'X' }).expect(401);
    });

    it('403 CSRF_INVALID without the CSRF header', async () => {
      const user = await signedIn();
      const res = await http()
        .patch('/api/v1/users/me')
        .set('Cookie', user.writeCookies)
        .send({ fullName: 'X' })
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });

    it('413 for a JSON body over the parser limit (not 500)', async () => {
      const user = await signedIn();
      const res = await patch(user.writeCookies, { fullName: 'x'.repeat(200_000) }).expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('avatar', () => {
    const upload = (cookies: string[], file: Buffer, filename = 'a.png', contentType = 'image/png') =>
      http()
        .put('/api/v1/users/me/avatar')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .attach('file', file, { filename, contentType });
    const keyOf = async (id: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { id }, select: { avatarObjectKey: true } })).avatarObjectKey;

    it('uploads a PNG and serves it back to its owner', async () => {
      const user = await signedIn();
      const res = await upload(user.writeCookies, PNG).expect(200);
      expect(res.body.avatarUrl).toMatch(/^\/api\/v1\/users\/me\/avatar\?v=/);
      const key = (await keyOf(user.id))!;
      const stored = await getBindings().IMAGES.get(key);
      expect(stored?.httpMetadata?.contentType).toBe('image/png');

      const img = await http()
        .get(res.body.avatarUrl as string)
        .set('Cookie', user.cookie)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(img.headers['cross-origin-resource-policy']).toBe('same-site');
      expect(img.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    });

    it('a second upload gets a new URL and deletes the first object', async () => {
      const user = await signedIn();
      const first = await upload(user.writeCookies, PNG).expect(200);
      const firstKey = (await keyOf(user.id))!;
      const second = await upload(user.writeCookies, JPEG, 'b.jpg', 'image/jpeg').expect(200);
      expect(second.body.avatarUrl).not.toBe(first.body.avatarUrl);
      expect(await getBindings().IMAGES.get(firstKey)).toBeNull();
    });

    it('parallel uploads keep exactly one object for the user', async () => {
      const user = await signedIn();
      const results = await Promise.all(Array.from({ length: 4 }, () => upload(user.writeCookies, PNG)));
      for (const r of results) expect([200, 409]).toContain(r.status);
      expect(results.some((r) => r.status === 200)).toBe(true);
      const listed = await getBindings().IMAGES.list({ prefix: `avatars/${user.id}/` });
      expect(listed.objects.map((o) => o.key)).toEqual([await keyOf(user.id)]);
    });

    it('stores the type found in the bytes, not the one the client sent', async () => {
      const user = await signedIn();
      await upload(user.writeCookies, PNG, 'a.jpg', 'image/jpeg').expect(200);
      const stored = await getBindings().IMAGES.get((await keyOf(user.id))!);
      expect(stored?.httpMetadata?.contentType).toBe('image/png');
    });

    it('415 UNSUPPORTED_IMAGE_TYPE for text bytes named as a PNG; avatar unchanged', async () => {
      const user = await signedIn();
      const res = await upload(user.writeCookies, Buffer.from('not an image')).expect(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
      expect(await keyOf(user.id)).toBeNull();
    });

    it('400 VALIDATION_FAILED without a file field, and for a JSON body', async () => {
      const user = await signedIn();
      const noFile = await http()
        .put('/api/v1/users/me/avatar')
        .set('Cookie', user.writeCookies)
        .set('X-CSRF-Token', csrf)
        .field('other', 'x')
        .expect(400);
      expect(noFile.body.error.code).toBe('VALIDATION_FAILED');
      const json = await http()
        .put('/api/v1/users/me/avatar')
        .set('Cookie', user.writeCookies)
        .set('X-CSRF-Token', csrf)
        .send({ file: 'x' })
        .expect(400);
      expect(json.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('413 PAYLOAD_TOO_LARGE for a file of 5 MB + 1 byte; avatar unchanged', async () => {
      const user = await signedIn();
      const big = Buffer.alloc(5 * 1024 * 1024 + 1);
      PNG.copy(big);
      const res = await upload(user.writeCookies, big).expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await keyOf(user.id)).toBeNull();
    });

    it('DELETE removes the photo and its object; idempotent', async () => {
      const user = await signedIn();
      await upload(user.writeCookies, PNG).expect(200);
      const key = (await keyOf(user.id))!;
      const del = () =>
        http().delete('/api/v1/users/me/avatar').set('Cookie', user.writeCookies).set('X-CSRF-Token', csrf);
      await del().expect(204);
      expect(await getBindings().IMAGES.get(key)).toBeNull();
      const me = await http().get('/api/v1/users/me').set('Cookie', user.cookie).expect(200);
      expect(me.body.avatarUrl).toBeNull();
      const res = await http().get('/api/v1/users/me/avatar').set('Cookie', user.cookie).expect(404);
      expect(res.body.error.code).toBe('AVATAR_NOT_FOUND');
      await del().expect(204);
    });

    it('401 without a session and 403 without CSRF for PUT and DELETE', async () => {
      await http().get('/api/v1/users/me/avatar').expect(401);
      await http()
        .put('/api/v1/users/me/avatar')
        .set('Cookie', csrfCookie)
        .set('X-CSRF-Token', csrf)
        .attach('file', PNG, 'a.png')
        .expect(401);
      await http().delete('/api/v1/users/me/avatar').set('Cookie', csrfCookie).set('X-CSRF-Token', csrf).expect(401);
      const user = await signedIn();
      const put = await http()
        .put('/api/v1/users/me/avatar')
        .set('Cookie', user.writeCookies)
        .attach('file', PNG, 'a.png')
        .expect(403);
      expect(put.body.error.code).toBe('CSRF_INVALID');
      const del = await http().delete('/api/v1/users/me/avatar').set('Cookie', user.writeCookies).expect(403);
      expect(del.body.error.code).toBe('CSRF_INVALID');
    });
  });
});
