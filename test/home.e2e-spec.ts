import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { getBindings } from '../src/cloudflare';
import { hashSessionToken, newSessionToken } from '../src/common/session-token';
import { PrismaService } from '../src/database/prisma.service';
import type { BoardVisibility, MemberRole } from '../src/generated/prisma/enums';

const DOMAIN = '@home.e2e.test';
const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
// e2e D1 is migrated but not seeded, so the test adds its own preset background.
const BG_KEY = 'e2e-home-bg';
const BG_THUMB = 'system/backgrounds/thumbs/e2e-home-bg.jpg';

interface Tile {
  id: string;
  name: string;
  starred: boolean;
  backgroundThumbnailUrl: string | null;
  backgroundColor: string;
}
interface WorkspaceTile {
  id: string;
  name: string;
  role: MemberRole | null;
  boardCount: number;
  memberCount: number | null;
  boards: Tile[];
}
interface PendingInvite {
  id: string;
  type: 'workspace' | 'board';
  workspace: { id: string; name: string };
  board: { id: string; name: string } | null;
  role: MemberRole;
  invitedBy: { fullName: string };
  expired: boolean;
}
interface Home {
  starred: Tile[];
  recent: Tile[];
  workspaces: WorkspaceTile[];
  invites: PendingInvite[];
  hasArchivedWorkspaces: boolean;
}

describe('Home, workspaces, boards and invites (e2e)', () => {
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
    // Cascades members, boards, stars and views.
    await prisma.workspace.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    // After the boards that reference it.
    await prisma.boardBackground.deleteMany({ where: { id: BG_KEY } });
    await getBindings().IMAGES.delete(BG_THUMB);
  }

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  /** A user with a live session. */
  async function signedIn(fullName = 'Home User') {
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
    return { ...user, cookie: `agi_sid=${token}` };
  }
  type TestUser = Awaited<ReturnType<typeof signedIn>>;

  const get = (u: TestUser, path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set('Cookie', u.cookie);
  const write = (method: 'post' | 'put' | 'delete', u: TestUser, path: string) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', [csrfCookie, u.cookie])
      .set('X-CSRF-Token', csrf);
  const home = async (u: TestUser) => {
    const res = await get(u, '/home').expect(200);
    return res.body as Home;
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
  async function makeBoard(
    workspaceId: string,
    creator: TestUser,
    name = 'B',
    opts: { visibility?: BoardVisibility; closed?: boolean } = {},
  ) {
    return prisma.board.create({
      data: {
        workspaceId,
        name,
        createdById: creator.id,
        visibility: opts.visibility ?? 'workspace',
        closedAt: opts.closed ? new Date() : null,
      },
      select: { id: true },
    });
  }
  const addWorkspaceMember = (workspaceId: string, u: TestUser, role: MemberRole = 'member') =>
    prisma.workspaceMember.create({ data: { workspaceId, userId: u.id, role } });
  const addBoardMember = (boardId: string, u: TestUser, role: MemberRole = 'member') =>
    prisma.boardMember.create({ data: { boardId, userId: u.id, role } });
  const makeInvite = (data: {
    workspaceId: string;
    boardId?: string;
    email: string;
    invitedById: string;
    role?: MemberRole;
    expiresAt?: Date;
    createdAt?: Date;
  }) =>
    prisma.invite.create({
      data: { ...data, expiresAt: data.expiresAt ?? new Date(Date.now() + 14 * DAY) },
      select: { id: true },
    });

  describe('auth', () => {
    it.each([
      ['get', '/home'],
      ['get', `/workspaces/${UNKNOWN_ID}`],
    ])('401 without a session on %s %s', async (_, path) => {
      await request(app.getHttpServer()).get(`/api/v1${path}`).expect(401);
    });

    it.each([
      ['post', '/workspaces'],
      ['put', `/boards/${UNKNOWN_ID}/star`],
      ['delete', `/boards/${UNKNOWN_ID}/star`],
      ['post', `/boards/${UNKNOWN_ID}/views`],
      ['post', `/invites/${UNKNOWN_ID}/accept`],
      ['post', `/invites/${UNKNOWN_ID}/decline`],
    ] as const)('401 without a session on %s %s', async (method, path) => {
      await request(app.getHttpServer())
        [method](`/api/v1${path}`)
        .set('Cookie', csrfCookie)
        .set('X-CSRF-Token', csrf)
        .expect(401);
    });
  });

  it('system roles grant no access to content', async () => {
    const owner = await signedIn();
    const w = await makeWorkspace(owner);
    const b = await makeBoard(w.id, owner);
    for (const systemRole of ['super_admin', 'support'] as const) {
      const staff = await signedIn();
      await prisma.user.update({ where: { id: staff.id }, data: { systemRole } });
      expect((await home(staff)).workspaces).toEqual([]);
      await get(staff, `/workspaces/${w.id}`).expect(404);
      await write('put', staff, `/boards/${b.id}/star`).expect(404);
    }
  });

  describe('US1 create workspace', () => {
    it('shows an empty Home to a new user', async () => {
      const me = await signedIn();
      expect(await home(me)).toEqual({
        starred: [],
        recent: [],
        workspaces: [],
        invites: [],
        hasArchivedWorkspaces: false,
      });
    });

    it('creates a workspace with the creator as admin and an audit row', async () => {
      const me = await signedIn('Ann Admin');
      const res = await write('post', me, '/workspaces').send({ name: '  Team  ' }).expect(201);
      const body = res.body as WorkspaceTile;
      expect(body).toEqual({
        id: expect.any(String) as string,
        name: 'Team',
        role: 'admin',
        boardCount: 0,
        memberCount: 1,
        boards: [],
      });
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId: body.id } });
      expect(members).toEqual([expect.objectContaining({ userId: me.id, role: 'admin' })]);
      const audit = await prisma.auditLogEntry.findMany({ where: { workspaceId: body.id } });
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'workspace_created',
          actorId: me.id,
          actorName: 'Ann Admin',
          targetType: 'workspace',
          targetId: body.id,
          targetLabel: 'Team',
        }),
      ]);
      expect((await home(me)).workspaces.map((w) => w.id)).toEqual([body.id]);
    });

    it('accepts a 100-character name (after trim)', async () => {
      const me = await signedIn();
      const name = 'n'.repeat(100);
      const res = await write('post', me, '/workspaces')
        .send({ name: `  ${name}  ` })
        .expect(201);
      expect((res.body as WorkspaceTile).name).toBe(name);
    });

    it('turns line breaks into spaces before storing', async () => {
      const me = await signedIn();
      const res = await write('post', me, '/workspaces')
        .send({ name: ' Team\r\nAlpha\n\nBeta\u2028Gamma ' })
        .expect(201);
      const body = res.body as WorkspaceTile;
      expect(body.name).toBe('Team Alpha Beta Gamma');
      const audit = await prisma.auditLogEntry.findFirst({ where: { workspaceId: body.id } });
      expect(audit?.targetLabel).toBe('Team Alpha Beta Gamma');
    });

    it('allows two workspaces with the same name', async () => {
      const me = await signedIn();
      const first = (await write('post', me, '/workspaces').send({ name: 'Team' }).expect(201)).body as WorkspaceTile;
      const second = (await write('post', me, '/workspaces').send({ name: 'Team' }).expect(201)).body as WorkspaceTile;
      expect(first.id).not.toBe(second.id);
      expect((await home(me)).workspaces.map((w) => w.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    });

    it.each([
      [{ name: '   ' }],
      [{ name: '\n\n' }],
      [{ name: '\r\n \n' }],
      [{}],
      [{ name: 'Ok', extra: 1 }],
      [{ name: 5 }],
      [{ name: 'n'.repeat(101) }],
    ])('400 VALIDATION_FAILED for %j', async (body) => {
      const me = await signedIn();
      const res = await write('post', me, '/workspaces').send(body).expect(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('403 CSRF_INVALID without the CSRF header', async () => {
      const me = await signedIn();
      const res = await request(app.getHttpServer())
        .post('/api/v1/workspaces')
        .set('Cookie', [csrfCookie, me.cookie])
        .send({ name: 'Team' })
        .expect(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('CSRF_INVALID');
    });
  });

  describe('US2 lists', () => {
    it('lists each workspace with name, board count and member count, by name', async () => {
      const me = await signedIn();
      const other = await signedIn();
      const w2 = await makeWorkspace(other, 'Beta');
      await addWorkspaceMember(w2.id, me);
      const w1 = await makeWorkspace(me, 'Alpha');
      await makeBoard(w1.id, me, 'B2');
      await makeBoard(w1.id, me, 'B1');
      await makeBoard(w1.id, me, 'Closed', { closed: true });
      const { workspaces } = await home(me);
      expect(workspaces.map((w) => [w.name, w.role, w.boardCount, w.memberCount])).toEqual([
        ['Alpha', 'admin', 2, 1],
        ['Beta', 'member', 0, 2],
      ]);
      expect(workspaces[0].boards.map((b) => b.name)).toEqual(['B1', 'B2']);
    });

    it('shows private boards only to admins and board members', async () => {
      const admin = await signedIn();
      const member = await signedIn();
      const w = await makeWorkspace(admin);
      await addWorkspaceMember(w.id, member);
      await makeBoard(w.id, admin, 'Open', { visibility: 'workspace' });
      const secret = await makeBoard(w.id, admin, 'Secret', { visibility: 'private' });
      expect((await home(member)).workspaces[0].boards.map((b) => b.name)).toEqual(['Open']);
      expect((await home(admin)).workspaces[0].boards.map((b) => b.name)).toEqual(['Open', 'Secret']);
      await addBoardMember(secret.id, member);
      expect((await home(member)).workspaces[0].boardCount).toBe(2);
    });

    it('shows a board-only member the workspace name and their boards only', async () => {
      const admin = await signedIn();
      const guest = await signedIn();
      const w = await makeWorkspace(admin, 'Client');
      await makeBoard(w.id, admin, 'Other', { visibility: 'workspace' });
      const mine = await makeBoard(w.id, admin, 'Mine', { visibility: 'private' });
      await addBoardMember(mine.id, guest);
      const { workspaces } = await home(guest);
      expect(workspaces).toEqual([
        expect.objectContaining({ name: 'Client', role: null, memberCount: null, boardCount: 1 }),
      ]);
      expect(workspaces[0].boards.map((b) => b.name)).toEqual(['Mine']);
      const res = await get(guest, `/workspaces/${w.id}`).expect(200);
      expect((res.body as WorkspaceTile).boards.map((b) => b.name)).toEqual(['Mine']);
    });

    it('hides archived workspaces and flags them for their admins only', async () => {
      const admin = await signedIn();
      const member = await signedIn();
      const w = await makeWorkspace(admin, 'Old', { archived: true });
      await addWorkspaceMember(w.id, member);
      const a = await home(admin);
      expect(a.workspaces).toEqual([]);
      expect(a.hasArchivedWorkspaces).toBe(true);
      const m = await home(member);
      expect(m.workspaces).toEqual([]);
      expect(m.hasArchivedWorkspaces).toBe(false);
    });

    it('GET /workspaces/:id returns the tile or 404', async () => {
      const admin = await signedIn();
      const outsider = await signedIn();
      const w = await makeWorkspace(admin, 'W');
      await makeBoard(w.id, admin, 'B');
      const archived = await makeWorkspace(admin, 'Gone', { archived: true });
      const res = await get(admin, `/workspaces/${w.id}`).expect(200);
      expect(res.body).toEqual(expect.objectContaining({ id: w.id, name: 'W', role: 'admin', boardCount: 1 }));
      for (const [u, id] of [
        [outsider, w.id],
        [admin, archived.id],
        [admin, UNKNOWN_ID],
      ] as const) {
        const r = await get(u, `/workspaces/${id}`).expect(404);
        expect((r.body as { error: { code: string } }).error.code).toBe('WORKSPACE_NOT_FOUND');
      }
      const bad = await get(admin, '/workspaces/not-a-uuid').expect(400);
      expect((bad.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('US3 invites', () => {
    it('lists a workspace invite with workspace and sender names; accept joins the workspace', async () => {
      const admin = await signedIn('Sam Sender');
      const me = await signedIn();
      const w = await makeWorkspace(admin, 'Team');
      const inv = await makeInvite({ workspaceId: w.id, email: me.email, invitedById: admin.id, role: 'admin' });
      expect((await home(me)).invites).toEqual([
        expect.objectContaining({
          id: inv.id,
          type: 'workspace',
          workspace: { id: w.id, name: 'Team' },
          board: null,
          role: 'admin',
          invitedBy: { fullName: 'Sam Sender' },
          expired: false,
        }),
      ]);
      const res = await write('post', me, `/invites/${inv.id}/accept`).expect(200);
      expect(res.body).toEqual({ workspaceId: w.id, boardId: null });
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: w.id, userId: me.id } },
      });
      expect(member?.role).toBe('admin');
      const row = await prisma.invite.findUnique({ where: { id: inv.id } });
      expect(row).toEqual(expect.objectContaining({ status: 'accepted', respondedById: me.id }));
      const after = await home(me);
      expect(after.invites).toEqual([]);
      expect(after.workspaces.map((x) => x.id)).toEqual([w.id]);
    });

    it('turns a board-only member into a workspace member, keeps board roles and accepts live board invites', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin);
      const b1 = await makeBoard(w.id, admin, 'B1', { visibility: 'private' });
      const b2 = await makeBoard(w.id, admin, 'B2', { visibility: 'private' });
      const b3 = await makeBoard(w.id, admin, 'B3', { visibility: 'private' });
      await addBoardMember(b1.id, me, 'admin');
      const wInv = await makeInvite({ workspaceId: w.id, email: me.email, invitedById: admin.id });
      const b2Inv = await makeInvite({ workspaceId: w.id, boardId: b2.id, email: me.email, invitedById: admin.id });
      const b3Inv = await makeInvite({
        workspaceId: w.id,
        boardId: b3.id,
        email: me.email,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() - DAY),
      });
      await write('post', me, `/invites/${wInv.id}/accept`).expect(200);
      const boards = await prisma.boardMember.findMany({
        where: { userId: me.id },
        select: { boardId: true, role: true },
      });
      expect(boards).toEqual(
        expect.arrayContaining([
          { boardId: b1.id, role: 'admin' },
          { boardId: b2.id, role: 'member' },
        ]),
      );
      expect(boards).toHaveLength(2);
      expect((await prisma.invite.findUnique({ where: { id: b2Inv.id } }))?.status).toBe('accepted');
      expect((await prisma.invite.findUnique({ where: { id: b3Inv.id } }))?.status).toBe('pending');
      expect((await home(me)).workspaces[0].role).toBe('member');
    });

    it('lists a board invite with board and workspace names; accept makes a board-only member', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin, 'Client');
      const b = await makeBoard(w.id, admin, 'Launch', { visibility: 'private' });
      const inv = await makeInvite({ workspaceId: w.id, boardId: b.id, email: me.email, invitedById: admin.id });
      expect((await home(me)).invites).toEqual([
        expect.objectContaining({
          type: 'board',
          workspace: { id: w.id, name: 'Client' },
          board: { id: b.id, name: 'Launch' },
        }),
      ]);
      const res = await write('post', me, `/invites/${inv.id}/accept`).expect(200);
      expect(res.body).toEqual({ workspaceId: w.id, boardId: b.id });
      expect(await prisma.boardMember.count({ where: { boardId: b.id, userId: me.id } })).toBe(1);
      expect(await prisma.workspaceMember.count({ where: { workspaceId: w.id, userId: me.id } })).toBe(0);
      expect((await home(me)).workspaces[0]).toEqual(expect.objectContaining({ role: null, boardCount: 1 }));
    });

    it('declines an invite', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({ workspaceId: w.id, email: me.email, invitedById: admin.id });
      await write('post', me, `/invites/${inv.id}/decline`).expect(204);
      expect((await prisma.invite.findUnique({ where: { id: inv.id } }))?.status).toBe('declined');
      expect((await home(me)).invites).toEqual([]);
    });

    it('an expired invite can be declined but not accepted', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({
        workspaceId: w.id,
        email: me.email,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() - 1000),
      });
      expect((await home(me)).invites[0].expired).toBe(true);
      const res = await write('post', me, `/invites/${inv.id}/accept`).expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVITE_EXPIRED');
      await write('post', me, `/invites/${inv.id}/decline`).expect(204);
    });

    it('lists newest first and hides invites of archived workspaces, closed boards and other emails', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin, 'A');
      const w2 = await makeWorkspace(admin, 'B');
      const archived = await makeWorkspace(admin, 'Old', { archived: true });
      const closed = await makeBoard(w.id, admin, 'Closed', { closed: true });
      const older = await makeInvite({
        workspaceId: w.id,
        email: me.email,
        invitedById: admin.id,
        createdAt: new Date(Date.now() - DAY),
      });
      const newer = await makeInvite({ workspaceId: w2.id, email: me.email, invitedById: admin.id });
      await makeInvite({ workspaceId: archived.id, email: me.email, invitedById: admin.id });
      await makeInvite({ workspaceId: w.id, boardId: closed.id, email: me.email, invitedById: admin.id });
      await makeInvite({ workspaceId: w.id, email: `someone${DOMAIN}`, invitedById: admin.id });
      expect((await home(me)).invites.map((i) => i.id)).toEqual([newer.id, older.id]);
    });

    it('404 INVITE_NOT_FOUND for another email, an answered invite or an unknown id; 400 for a bad id', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin);
      const theirs = await makeInvite({ workspaceId: w.id, email: `other${DOMAIN}`, invitedById: admin.id });
      const answered = await makeInvite({ workspaceId: w.id, email: me.email, invitedById: admin.id });
      await prisma.invite.update({ where: { id: answered.id }, data: { status: 'declined' } });
      for (const id of [theirs.id, answered.id, UNKNOWN_ID]) {
        for (const action of ['accept', 'decline']) {
          const res = await write('post', me, `/invites/${id}/${action}`).expect(404);
          expect((res.body as { error: { code: string } }).error.code).toBe('INVITE_NOT_FOUND');
        }
      }
      const bad = await write('post', me, '/invites/nope/accept').expect(400);
      expect((bad.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('two concurrent accepts: one wins, one membership row', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin);
      const inv = await makeInvite({ workspaceId: w.id, email: me.email, invitedById: admin.id });
      const results = await Promise.all([
        write('post', me, `/invites/${inv.id}/accept`),
        write('post', me, `/invites/${inv.id}/accept`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(await prisma.workspaceMember.count({ where: { workspaceId: w.id, userId: me.id } })).toBe(1);
    });
  });

  describe('board tile background', () => {
    it('gives a thumbnail URL for a preset background and null without one', async () => {
      const me = await signedIn();
      const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      await getBindings().IMAGES.put(BG_THUMB, image, { httpMetadata: { contentType: 'image/jpeg' } });
      await prisma.boardBackground.create({
        data: {
          id: BG_KEY,
          name: 'E2E',
          imageObjectKey: 'system/backgrounds/e2e-home-bg.jpg',
          thumbnailObjectKey: BG_THUMB,
          sortOrder: 9999,
        },
      });
      const w = await makeWorkspace(me);
      const withBg = await makeBoard(w.id, me, 'A');
      await prisma.board.update({ where: { id: withBg.id }, data: { backgroundKey: BG_KEY } });
      const plain = await makeBoard(w.id, me, 'B');
      await prisma.board.update({ where: { id: plain.id }, data: { backgroundColor: '#8b5fd0' } });

      const [a, b] = (await home(me)).workspaces[0].boards;
      expect(a.backgroundThumbnailUrl).toBe(`/api/v1/board-backgrounds/${BG_KEY}/thumbnail`);
      expect(b.backgroundThumbnailUrl).toBeNull();
      // Every board has a color; the client shows it when there is no image (AC 9.2).
      expect(b.backgroundColor).toBe('#8b5fd0');
      expect(a.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);

      const img = await request(app.getHttpServer())
        .get(a.backgroundThumbnailUrl!)
        .set('Cookie', me.cookie)
        .buffer(true)
        .expect(200);
      expect(img.headers['content-type']).toBe('image/jpeg');
      expect(new Uint8Array(img.body as Buffer)).toEqual(image);
    });

    it('404 BACKGROUND_NOT_FOUND for an unknown key; 401 without a session', async () => {
      const me = await signedIn();
      const res = await get(me, '/board-backgrounds/nope/thumbnail').expect(404);
      expect((res.body as { error: { code: string } }).error.code).toBe('BACKGROUND_NOT_FOUND');
      await request(app.getHttpServer()).get(`/api/v1/board-backgrounds/${BG_KEY}/thumbnail`).expect(401);
    });
  });

  describe('US4 starred and recent', () => {
    it('lists starred boards and, independently, the 6 most recently viewed boards', async () => {
      const me = await signedIn();
      const w = await makeWorkspace(me);
      const boards = [];
      for (let i = 0; i < 9; i++) boards.push(await makeBoard(w.id, me, `B${i}`));
      // Views B0..B7, B7 newest; B6 and B7 are starred, B8 is starred but never viewed.
      for (let i = 0; i < 8; i++) {
        await prisma.boardView.create({
          data: { userId: me.id, boardId: boards[i].id, lastViewedAt: new Date(Date.now() - (10 - i) * 1000) },
        });
      }
      for (const [n, i] of [8, 6, 7].entries()) {
        await prisma.boardStar.create({
          data: { userId: me.id, boardId: boards[i].id, createdAt: new Date(Date.now() - (5 - n) * 1000) },
        });
      }
      const h = await home(me);
      expect(h.starred.map((b) => b.name)).toEqual(['B8', 'B6', 'B7']);
      expect(h.starred.every((b) => b.starred)).toBe(true);
      // A starred board stays in Recently viewed too; the tile carries `starred`.
      expect(h.recent.map((b) => [b.name, b.starred])).toEqual([
        ['B7', true],
        ['B6', true],
        ['B5', false],
        ['B4', false],
        ['B3', false],
        ['B2', false],
      ]);
    });

    it('drops boards that are closed, in an archived workspace or no longer accessible', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w1 = await makeWorkspace(admin, 'W1');
      const w2 = await makeWorkspace(admin, 'W2');
      await addWorkspaceMember(w1.id, me);
      await addWorkspaceMember(w2.id, me);
      const closing = await makeBoard(w1.id, admin, 'Closing');
      const lost = await makeBoard(w1.id, admin, 'Lost', { visibility: 'private' });
      await addBoardMember(lost.id, me);
      const archivedLater = await makeBoard(w2.id, admin, 'InArchived');
      for (const b of [closing, lost, archivedLater]) {
        await write('put', me, `/boards/${b.id}/star`).expect(204);
        await write('post', me, `/boards/${b.id}/views`).expect(204);
      }
      expect((await home(me)).starred).toHaveLength(3);
      await prisma.board.update({ where: { id: closing.id }, data: { closedAt: new Date() } });
      await prisma.boardMember.deleteMany({ where: { boardId: lost.id, userId: me.id } });
      await prisma.workspace.update({ where: { id: w2.id }, data: { archivedAt: new Date() } });
      const h = await home(me);
      expect(h.starred).toEqual([]);
      expect(h.recent).toEqual([]);
    });

    it('star, unstar and record a view are idempotent', async () => {
      const me = await signedIn();
      const w = await makeWorkspace(me);
      const b = await makeBoard(w.id, me);
      await write('put', me, `/boards/${b.id}/star`).expect(204);
      await write('put', me, `/boards/${b.id}/star`).expect(204);
      expect(await prisma.boardStar.count({ where: { userId: me.id, boardId: b.id } })).toBe(1);
      await write('delete', me, `/boards/${b.id}/star`).expect(204);
      await write('delete', me, `/boards/${b.id}/star`).expect(204);
      expect(await prisma.boardStar.count({ where: { userId: me.id, boardId: b.id } })).toBe(0);

      await write('post', me, `/boards/${b.id}/views`).expect(204);
      const first = await prisma.boardView.findUnique({ where: { userId_boardId: { userId: me.id, boardId: b.id } } });
      await new Promise((r) => setTimeout(r, 5));
      await write('post', me, `/boards/${b.id}/views`).expect(204);
      const views = await prisma.boardView.findMany({ where: { userId: me.id, boardId: b.id } });
      expect(views).toHaveLength(1);
      expect(views[0].lastViewedAt.getTime()).toBeGreaterThan(first!.lastViewedAt.getTime());
    });

    it('404 BOARD_NOT_FOUND on a board the user cannot see, a closed board or an unknown id; 400 for a bad id', async () => {
      const admin = await signedIn();
      const me = await signedIn();
      const w = await makeWorkspace(admin);
      await addWorkspaceMember(w.id, me);
      const hidden = await makeBoard(w.id, admin, 'Private', { visibility: 'private' });
      const closed = await makeBoard(w.id, admin, 'Closed', { closed: true });
      for (const id of [hidden.id, closed.id, UNKNOWN_ID]) {
        for (const [method, path] of [
          ['put', 'star'],
          ['post', 'views'],
        ] as const) {
          const res = await write(method, me, `/boards/${id}/${path}`).expect(404);
          expect((res.body as { error: { code: string } }).error.code).toBe('BOARD_NOT_FOUND');
        }
      }
      const bad = await write('put', me, '/boards/nope/star').expect(400);
      expect((bad.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });
  });
});
