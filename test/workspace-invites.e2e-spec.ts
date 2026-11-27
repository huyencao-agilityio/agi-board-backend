import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import type { InviteStatus, MemberRole } from '../src/generated/prisma/enums';

const DOMAIN = '@invites.e2e.test';
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

interface InviteItem {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  lastSentAt: string;
  expired: boolean;
  invitedBy: { id: string; fullName: string };
}

describe('Workspace invites, admin side (e2e)', () => {
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

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.invite.deleteMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { invitedById: { in: ids } }] } });
    await prisma.workspace.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function signedIn(fullName = 'Invite User') {
    const token = newSessionToken();
    const user = await prisma.user.create({
      data: {
        email: `${token.slice(0, 8).toLowerCase()}${DOMAIN}`,
        fullName,
        passwordHash: 'not-a-real-hash',
        sessions: { create: { tokenHash: hashSessionToken(token) } },
      },
      select: { id: true, email: true },
    });
    return { ...user, fullName, cookie: `agi_sid=${token}` };
  }
  type TestUser = Awaited<ReturnType<typeof signedIn>>;

  const get = (u: TestUser, path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set('Cookie', u.cookie);
  const write = (method: 'post' | 'delete', u: TestUser, path: string) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', [csrfCookie, u.cookie])
      .set('X-CSRF-Token', csrf);
  const homeInvites = async (u: TestUser) => {
    const res = await get(u, '/home').expect(200);
    return (res.body as { invites: { id: string; type: string; role: MemberRole; expired: boolean }[] }).invites;
  };

  async function makeWorkspace(owner: TestUser, name = 'W', opts: { archived?: boolean } = {}) {
    return prisma.workspace.create({
      data: {
        name,
        createdById: owner.id,
        archivedAt: opts.archived ? new Date() : null,
        workspaceMembers: { create: { userId: owner.id, role: 'admin' } },
      },
      select: { id: true },
    });
  }
  const makeBoard = (workspaceId: string, creator: TestUser) =>
    prisma.board.create({ data: { workspaceId, name: 'B', createdById: creator.id }, select: { id: true } });
  const addWorkspaceMember = (workspaceId: string, u: TestUser, role: MemberRole = 'member') =>
    prisma.workspaceMember.create({ data: { workspaceId, userId: u.id, role } });
  const addBoardMember = (boardId: string, u: TestUser) =>
    prisma.boardMember.create({ data: { boardId, userId: u.id, role: 'member' } });
  const makeInvite = (data: {
    workspaceId: string;
    invitedById: string;
    email?: string;
    boardId?: string;
    role?: MemberRole;
    status?: InviteStatus;
    expiresAt?: Date;
    lastSentAt?: Date;
  }) =>
    prisma.invite.create({
      data: {
        ...data,
        email: data.email ?? `guest-${Math.random().toString(36).slice(2, 10)}${DOMAIN}`,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 14 * DAY),
      },
      select: { id: true, email: true },
    });
  const nearly = (iso: string, expected: number) =>
    expect(Math.abs(new Date(iso).getTime() - expected)).toBeLessThan(MINUTE);

  /** Admin of a fresh workspace with one pending invite. */
  async function setup() {
    const admin = await signedIn('Ada Admin');
    const w = await makeWorkspace(admin, 'Marketing');
    const inv = await makeInvite({
      workspaceId: w.id,
      invitedById: admin.id,
      lastSentAt: new Date(Date.now() - 2 * MINUTE),
    });
    return { admin, w, inv };
  }

  describe('access', () => {
    const routes: [string, 'get' | 'post' | 'delete', (w: string, i: string) => string][] = [
      ['create', 'post', (w) => `/workspaces/${w}/invites`],
      ['list', 'get', (w) => `/workspaces/${w}/invites`],
      ['resend', 'post', (w, i) => `/workspaces/${w}/invites/${i}/resend`],
      ['revoke', 'delete', (w, i) => `/workspaces/${w}/invites/${i}`],
    ];
    const call = (u: TestUser, method: 'get' | 'post' | 'delete', path: string) => {
      const req = method === 'get' ? get(u, path) : write(method, u, path);
      return path.endsWith('/invites') && method === 'post' ? req.send({ email: `x${DOMAIN}` }) : req;
    };

    it.each(routes)('%s: 401 without a session', async (_, method, path) => {
      const { w, inv } = await setup();
      // CSRF is checked first, so a write sends it to reach the session check.
      await request(app.getHttpServer())
        [method](`/api/v1${path(w.id, inv.id)}`)
        .set('Cookie', csrfCookie)
        .set('X-CSRF-Token', csrf)
        .expect(401);
    });

    it.each(routes)('%s: 404 for an outsider, an archived workspace and an unknown id', async (_, method, path) => {
      const { admin, w, inv } = await setup();
      const outsider = await signedIn();
      const archived = await makeWorkspace(admin, 'Old', { archived: true });
      for (const [u, ws] of [
        [outsider, w.id],
        [admin, archived.id],
        [admin, UNKNOWN_ID],
      ] as const) {
        const res = await call(u, method, path(ws, inv.id)).expect(404);
        expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND');
      }
    });

    it.each(routes)('%s: 403 for a workspace member and a board-only member', async (_, method, path) => {
      const { admin, w, inv } = await setup();
      const member = await signedIn();
      await addWorkspaceMember(w.id, member);
      const boardOnly = await signedIn();
      await addBoardMember((await makeBoard(w.id, admin)).id, boardOnly);
      for (const u of [member, boardOnly]) {
        const res = await call(u, method, path(w.id, inv.id)).expect(403);
        expect(res.body.error.code).toBe('INVITE_MANAGE_FORBIDDEN');
      }
    });

    it.each(routes.filter(([, m]) => m !== 'get'))(
      '%s: 403 CSRF_INVALID without the header',
      async (_, method, path) => {
        const { admin, w, inv } = await setup();
        const res = await request(app.getHttpServer())
          [method](`/api/v1${path(w.id, inv.id)}`)
          .set('Cookie', [csrfCookie, admin.cookie])
          .expect(403);
        expect(res.body.error.code).toBe('CSRF_INVALID');
      },
    );

    it.each(routes)('%s: 400 for a bad id', async (_, method, path) => {
      const { admin, w, inv } = await setup();
      const bad = new Set([path('not-a-uuid', inv.id), path(w.id, 'not-a-uuid')]);
      bad.delete(path(w.id, inv.id)); // create and list have no invite id
      for (const p of bad) {
        const res = await call(admin, method, p).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('US1 send and list', () => {
    it('creates a pending workspace invite, an audit row without the email, and lists it', async () => {
      const admin = await signedIn('Ada Admin');
      const w = await makeWorkspace(admin, 'Marketing');
      const res = await write('post', admin, `/workspaces/${w.id}/invites`)
        .send({ email: ' New@Invites.E2E.test ', role: 'admin' })
        .expect(201);
      const item = res.body as InviteItem;
      expect(item).toEqual(
        expect.objectContaining({
          email: 'new@invites.e2e.test',
          role: 'admin',
          expired: false,
          invitedBy: { id: admin.id, fullName: 'Ada Admin' },
        }),
      );
      nearly(item.expiresAt, Date.now() + 14 * DAY);
      nearly(item.lastSentAt, Date.now());

      const row = await prisma.invite.findUnique({ where: { id: item.id } });
      expect(row).toEqual(
        expect.objectContaining({ workspaceId: w.id, boardId: null, status: 'pending', invitedById: admin.id }),
      );
      const audit = await prisma.auditLogEntry.findMany({ where: { workspaceId: w.id } });
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'invite',
          actorId: admin.id,
          actorName: 'Ada Admin',
          targetType: 'invite',
          targetId: item.id,
          targetLabel: '',
          data: { role: 'admin' },
        }),
      ]);
      expect(JSON.stringify(audit)).not.toContain('new@invites.e2e.test');

      const list = await get(admin, `/workspaces/${w.id}/invites`).expect(200);
      expect(list.body).toEqual({ items: [item], nextCursor: null });
    });

    it('defaults role to member', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const res = await write('post', admin, `/workspaces/${w.id}/invites`)
        .send({ email: `m${DOMAIN}` })
        .expect(201);
      expect(res.body.role).toBe('member');
    });

    it('409 INVITE_PENDING when a pending invite exists, expired or not', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const w2 = await makeWorkspace(admin, 'W2');
      const valid = await makeInvite({ workspaceId: w.id, invitedById: admin.id });
      const expired = await makeInvite({
        workspaceId: w2.id,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() - DAY),
      });
      for (const [ws, email] of [
        [w.id, valid.email],
        [w2.id, expired.email],
      ]) {
        const res = await write('post', admin, `/workspaces/${ws}/invites`).send({ email }).expect(409);
        expect(res.body.error.code).toBe('INVITE_PENDING');
      }
    });

    it('allows a new invite after the old one was declined or revoked', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const lastSentAt = new Date(Date.now() - 2 * MINUTE);
      for (const status of ['declined', 'revoked'] as const) {
        const old = await makeInvite({ workspaceId: w.id, invitedById: admin.id, status, lastSentAt });
        await write('post', admin, `/workspaces/${w.id}/invites`).send({ email: old.email }).expect(201);
      }
    });

    it('429 RESEND_COOLDOWN when the same address was sent an invite here less than 60 s ago, even if revoked', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const email = `loop${DOMAIN}`;
      const sent = await write('post', admin, `/workspaces/${w.id}/invites`).send({ email }).expect(201);
      await write('delete', admin, `/workspaces/${w.id}/invites/${sent.body.id}`).expect(204);
      const res = await write('post', admin, `/workspaces/${w.id}/invites`).send({ email }).expect(429);
      expect(res.body.error.code).toBe('RESEND_COOLDOWN');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      // Another workspace is a different target.
      const w2 = await makeWorkspace(admin, 'W2');
      await write('post', admin, `/workspaces/${w2.id}/invites`).send({ email }).expect(201);
    });

    it('429 INVITE_RATE_LIMITED after 50 new invites in an hour by the same person, across workspaces', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const w2 = await makeWorkspace(admin, 'W2');
      await prisma.invite.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          workspaceId: i % 2 ? w.id : w2.id,
          invitedById: admin.id,
          email: `bulk${i}${DOMAIN}`,
          status: 'revoked' as const,
          expiresAt: new Date(Date.now() + 14 * DAY),
          lastSentAt: new Date(Date.now() - 2 * MINUTE),
        })),
      });
      const res = await write('post', admin, `/workspaces/${w.id}/invites`)
        .send({ email: `one-more${DOMAIN}` })
        .expect(429);
      expect(res.body.error.code).toBe('INVITE_RATE_LIMITED');
      // An hour later the window has moved.
      await prisma.invite.updateMany({
        where: { invitedById: admin.id },
        data: { createdAt: new Date(Date.now() - 61 * MINUTE) },
      });
      await write('post', admin, `/workspaces/${w.id}/invites`)
        .send({ email: `one-more${DOMAIN}` })
        .expect(201);
    });

    it("409 ALREADY_MEMBER for a workspace member's address, including the admin's own", async () => {
      const admin = await signedIn();
      const member = await signedIn();
      const w = await makeWorkspace(admin);
      await addWorkspaceMember(w.id, member);
      for (const email of [member.email, admin.email.toUpperCase()]) {
        const res = await write('post', admin, `/workspaces/${w.id}/invites`).send({ email }).expect(409);
        expect(res.body.error.code).toBe('ALREADY_MEMBER');
      }
    });

    it('one of two parallel invites to the same address wins', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const email = `race${DOMAIN}`;
      const results = await Promise.all(
        [1, 2].map(() => write('post', admin, `/workspaces/${w.id}/invites`).send({ email })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('INVITE_PENDING');
      expect(await prisma.invite.count({ where: { workspaceId: w.id, email } })).toBe(1);
      expect(await prisma.auditLogEntry.count({ where: { workspaceId: w.id } })).toBe(1);
    });

    it.each([
      ['missing email', {}],
      ['not an email', { email: 'not-an-email' }],
      [
        'over 254 characters',
        { email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}.test` },
      ],
      ['unknown role', { email: `r${DOMAIN}`, role: 'owner' }],
      ['unknown field', { email: `f${DOMAIN}`, boardId: UNKNOWN_ID }],
    ])('400 VALIDATION_FAILED: %s', async (_, body) => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const res = await write('post', admin, `/workspaces/${w.id}/invites`).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('lists only pending workspace invites, newest first, with expired flagged and a cursor', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const other = await makeWorkspace(admin, 'Other');
      const board = await makeBoard(w.id, admin);
      const expired = await makeInvite({
        workspaceId: w.id,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() - DAY),
      });
      await makeInvite({ workspaceId: w.id, invitedById: admin.id, status: 'accepted' });
      await makeInvite({ workspaceId: w.id, invitedById: admin.id, status: 'revoked' });
      await makeInvite({ workspaceId: w.id, invitedById: admin.id, boardId: board.id });
      await makeInvite({ workspaceId: other.id, invitedById: admin.id });
      const valid = await makeInvite({ workspaceId: w.id, invitedById: admin.id });

      const all = await get(admin, `/workspaces/${w.id}/invites`).expect(200);
      expect((all.body.items as InviteItem[]).map((i) => [i.id, i.expired])).toEqual([
        [valid.id, false],
        [expired.id, true],
      ]);

      const page1 = await get(admin, `/workspaces/${w.id}/invites?limit=1`).expect(200);
      expect((page1.body.items as InviteItem[]).map((i) => i.id)).toEqual([valid.id]);
      expect(page1.body.nextCursor).toBe(valid.id);
      const page2 = await get(admin, `/workspaces/${w.id}/invites?limit=1&cursor=${valid.id}`).expect(200);
      expect(page2.body).toEqual({ items: [expect.objectContaining({ id: expired.id })], nextCursor: null });

      for (const q of ['limit=0', 'limit=101', 'cursor=nope']) {
        const res = await get(admin, `/workspaces/${w.id}/invites?${q}`).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('US2 resend and revoke', () => {
    it('resend renews an expired invite', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({
        workspaceId: w.id,
        invitedById: admin.id,
        role: 'admin',
        expiresAt: new Date(Date.now() - DAY),
        lastSentAt: new Date(Date.now() - 2 * MINUTE),
      });
      const res = await write('post', admin, `/workspaces/${w.id}/invites/${inv.id}/resend`).expect(200);
      const item = res.body as InviteItem;
      expect(item).toEqual(expect.objectContaining({ id: inv.id, role: 'admin', expired: false }));
      nearly(item.expiresAt, Date.now() + 14 * DAY);
      nearly(item.lastSentAt, Date.now());
      const row = await prisma.invite.findUnique({ where: { id: inv.id } });
      expect(row?.status).toBe('pending');
      expect(await prisma.auditLogEntry.count({ where: { workspaceId: w.id } })).toBe(0);
    });

    it('resend renews a still-valid invite', async () => {
      const { admin, w, inv } = await setup();
      await write('post', admin, `/workspaces/${w.id}/invites/${inv.id}/resend`).expect(200);
    });

    it('429 RESEND_COOLDOWN within 60 seconds', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const expiresAt = new Date(Date.now() + DAY);
      const inv = await makeInvite({
        workspaceId: w.id,
        invitedById: admin.id,
        expiresAt,
        lastSentAt: new Date(Date.now() - 10 * 1000),
      });
      const res = await write('post', admin, `/workspaces/${w.id}/invites/${inv.id}/resend`).expect(429);
      expect(res.body.error.code).toBe('RESEND_COOLDOWN');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(45);
      expect(res.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(50);
      const row = await prisma.invite.findUnique({ where: { id: inv.id } });
      expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
    });

    it('429 RESEND_COOLDOWN right after create', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const sent = await write('post', admin, `/workspaces/${w.id}/invites`)
        .send({ email: `fresh${DOMAIN}` })
        .expect(201);
      const res = await write('post', admin, `/workspaces/${w.id}/invites/${sent.body.id}/resend`).expect(429);
      expect(res.body.error.code).toBe('RESEND_COOLDOWN');
    });

    it('one of two parallel resends wins', async () => {
      const { admin, w, inv } = await setup();
      const results = await Promise.all(
        [1, 2].map(() => write('post', admin, `/workspaces/${w.id}/invites/${inv.id}/resend`)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    });

    it("revoke removes the invite from the list and from the invitee's Home", async () => {
      const admin = await signedIn();
      const invitee = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({ workspaceId: w.id, invitedById: admin.id, email: invitee.email });
      expect((await homeInvites(invitee)).map((i) => i.id)).toEqual([inv.id]);

      await write('delete', admin, `/workspaces/${w.id}/invites/${inv.id}`).expect(204);
      const row = await prisma.invite.findUnique({ where: { id: inv.id } });
      expect(row).toEqual(expect.objectContaining({ status: 'revoked', respondedAt: null }));
      expect((await get(admin, `/workspaces/${w.id}/invites`).expect(200)).body.items).toEqual([]);
      expect(await homeInvites(invitee)).toEqual([]);
      const accept = await write('post', invitee, `/invites/${inv.id}/accept`).expect(404);
      expect(accept.body.error.code).toBe('INVITE_NOT_FOUND');
    });

    it('revoke works on an expired invite', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({ workspaceId: w.id, invitedById: admin.id, expiresAt: new Date(Date.now() - DAY) });
      await write('delete', admin, `/workspaces/${w.id}/invites/${inv.id}`).expect(204);
    });

    it('404 INVITE_NOT_FOUND for resend and revoke of invites that are not pending workspace invites here', async () => {
      const admin = await signedIn();
      const w = await makeWorkspace(admin);
      const other = await makeWorkspace(admin, 'Other');
      const board = await makeBoard(w.id, admin);
      const old = new Date(Date.now() - 2 * MINUTE);
      const ids = [
        UNKNOWN_ID,
        (await makeInvite({ workspaceId: w.id, invitedById: admin.id, status: 'accepted', lastSentAt: old })).id,
        (await makeInvite({ workspaceId: w.id, invitedById: admin.id, status: 'revoked', lastSentAt: old })).id,
        (await makeInvite({ workspaceId: w.id, invitedById: admin.id, boardId: board.id, lastSentAt: old })).id,
        (await makeInvite({ workspaceId: other.id, invitedById: admin.id, lastSentAt: old })).id,
      ];
      for (const id of ids) {
        for (const req of [
          write('post', admin, `/workspaces/${w.id}/invites/${id}/resend`),
          write('delete', admin, `/workspaces/${w.id}/invites/${id}`),
        ]) {
          const res = await req.expect(404);
          expect(res.body.error.code).toBe('INVITE_NOT_FOUND');
        }
      }
    });
  });

  describe('US3 invitee', () => {
    it("an invite sent by the admin appears on the invitee's Home and accept joins with the invited role", async () => {
      const admin = await signedIn();
      const invitee = await signedIn();
      const w = await makeWorkspace(admin);
      const sent = await write('post', admin, `/workspaces/${w.id}/invites`)
        .send({ email: invitee.email, role: 'admin' })
        .expect(201);
      expect(await homeInvites(invitee)).toEqual([
        expect.objectContaining({ id: sent.body.id, type: 'workspace', role: 'admin', expired: false }),
      ]);
      const res = await write('post', invitee, `/invites/${sent.body.id}/accept`).expect(200);
      expect(res.body).toEqual({ workspaceId: w.id, boardId: null });
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: w.id, userId: invitee.id } },
      });
      expect(member?.role).toBe('admin');
      expect((await get(admin, `/workspaces/${w.id}/invites`).expect(200)).body.items).toEqual([]);
    });

    it('decline removes it from Home and lets the admin invite again', async () => {
      const admin = await signedIn();
      const invitee = await signedIn();
      const w = await makeWorkspace(admin);
      const sent = await write('post', admin, `/workspaces/${w.id}/invites`).send({ email: invitee.email }).expect(201);
      await write('post', invitee, `/invites/${sent.body.id}/decline`).expect(204);
      expect(await homeInvites(invitee)).toEqual([]);
      // Past the 60 s cooldown on that address.
      await prisma.invite.update({
        where: { id: sent.body.id },
        data: { lastSentAt: new Date(Date.now() - 2 * MINUTE) },
      });
      await write('post', admin, `/workspaces/${w.id}/invites`).send({ email: invitee.email }).expect(201);
    });

    it('a resent expired invite can be accepted', async () => {
      const admin = await signedIn();
      const invitee = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({
        workspaceId: w.id,
        invitedById: admin.id,
        email: invitee.email,
        expiresAt: new Date(Date.now() - DAY),
        lastSentAt: new Date(Date.now() - 15 * DAY),
      });
      const expired = await write('post', invitee, `/invites/${inv.id}/accept`).expect(409);
      expect(expired.body.error.code).toBe('INVITE_EXPIRED');
      await write('post', admin, `/workspaces/${w.id}/invites/${inv.id}/resend`).expect(200);
      await write('post', invitee, `/invites/${inv.id}/accept`).expect(200);
    });
  });
});
