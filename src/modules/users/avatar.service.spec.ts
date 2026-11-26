import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { setBindings, type Bindings } from '../../cloudflare';
import type { PrismaService } from '../../database/prisma.service';
import { AvatarService } from './avatar.service';
import type { ProfileService } from './profile.service';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A multipart request whose body is a readable stream, like Express's `req`. */
async function multipart(file: Uint8Array | null, filename = 'a.png', type = 'image/png') {
  const form = new FormData();
  if (file) form.append('file', new Blob([file.slice()], { type }), filename);
  else form.append('other', 'x');
  const res = new Response(form);
  const body = Buffer.from(await res.arrayBuffer());
  const req = Readable.from([body]) as unknown as Request;
  const contentType = res.headers.get('content-type')!;
  (req as unknown as { get: (h: string) => string | undefined }).get = (h) =>
    h.toLowerCase() === 'content-type' ? contentType : undefined;
  return req;
}

function setup(oldKey: string | null = 'avatars/u1/old') {
  const calls: string[] = [];
  const objects = new Map<string, Uint8Array>();
  const images = {
    put: jest.fn<Promise<void>, [string, Uint8Array, unknown?]>((key, bytes) => {
      calls.push(`put ${key.startsWith('avatars/u1/') ? 'new' : key}`);
      objects.set(key, bytes);
      return Promise.resolve();
    }),
    delete: jest.fn((key: string) => {
      calls.push(`delete ${key === oldKey ? 'old' : 'new'}`);
      objects.delete(key);
      return Promise.resolve();
    }),
    get: jest.fn(),
  };
  setBindings({ IMAGES: images } as unknown as Bindings);
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ avatarObjectKey: oldKey }),
      updateMany: jest.fn(() => {
        calls.push('update');
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const profile = { getProfile: jest.fn().mockResolvedValue({ id: 'u1' }) };
  const service = new AvatarService(prisma as unknown as PrismaService, profile as unknown as ProfileService);
  const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  return { service, images, prisma, calls, warn };
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : 'not-http';
  }
  return 'resolved';
};

describe('AvatarService.upload', () => {
  it('puts the new object, updates the user, then deletes the old object', async () => {
    const { service, calls, images } = setup();
    await service.upload('u1', await multipart(PNG));
    expect(calls).toEqual(['put new', 'update', 'delete old']);
    expect(images.put.mock.calls[0][2]).toEqual({ httpMetadata: { contentType: 'image/png' } });
  });

  it('stores the detected type, not the type the client sent', async () => {
    const { service, images } = setup(null);
    await service.upload('u1', await multipart(PNG, 'a.jpg', 'image/jpeg'));
    expect(images.put.mock.calls[0][2]).toEqual({ httpMetadata: { contentType: 'image/png' } });
  });

  it('still resolves when deleting the old object fails, and logs it', async () => {
    const { service, images, warn } = setup();
    images.delete.mockRejectedValueOnce(new Error('r2 down'));
    await expect(service.upload('u1', await multipart(PNG))).resolves.toEqual({ id: 'u1' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('deletes the new object and rethrows when the database update fails', async () => {
    const { service, prisma, calls } = setup();
    prisma.user.updateMany.mockRejectedValueOnce(new Error('db down'));
    await expect(service.upload('u1', await multipart(PNG))).rejects.toThrow('db down');
    expect(calls).toEqual(['put new', 'delete new']);
  });

  it('409 AVATAR_CONFLICT and deletes its new object when a parallel request changed the avatar', async () => {
    const { service, prisma, calls } = setup();
    prisma.user.updateMany.mockImplementationOnce(() => {
      calls.push('update');
      return Promise.resolve({ count: 0 });
    });
    expect(await statusOf(service.upload('u1', await multipart(PNG)))).toBe(409);
    expect(calls).toEqual(['put new', 'update', 'delete new']);
  });

  it('413 from a declared Content-Length over the limit, before reading the body', async () => {
    const { service, images } = setup();
    const req = await multipart(PNG);
    const get = req.get.bind(req) as (h: string) => string | undefined;
    (req as unknown as { get: (h: string) => string | undefined }).get = (h) =>
      h.toLowerCase() === 'content-length' ? String(6 * 1024 * 1024) : get(h);
    expect(await statusOf(service.upload('u1', req))).toBe(413);
    expect(images.put).not.toHaveBeenCalled();
  });

  it.each([
    ['text bytes', async () => multipart(new TextEncoder().encode('hello')), 415],
    ['no file field', async () => multipart(null), 400],
    ['over 5 MB', async () => multipart(new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff)), 413],
  ])('rejects %s before any put', async (_name, makeReq, status) => {
    const { service, images } = setup();
    expect(await statusOf(service.upload('u1', await makeReq()))).toBe(status);
    expect(images.put).not.toHaveBeenCalled();
  });

  it('rejects a non-multipart request with 400', async () => {
    const { service } = setup();
    const req = Readable.from([Buffer.from('{}')]) as unknown as Request;
    (req as unknown as { get: () => string }).get = () => 'application/json';
    expect(await statusOf(service.upload('u1', req))).toBe(400);
  });
});

describe('AvatarService.remove', () => {
  it('does not touch R2 when there is no avatar', async () => {
    const { service, images, prisma } = setup(null);
    await service.remove('u1');
    expect(images.delete).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the object when a parallel upload already replaced the key', async () => {
    const { service, prisma, images } = setup();
    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.remove('u1');
    expect(images.delete).not.toHaveBeenCalled();
  });

  it('clears the key, then deletes the object', async () => {
    const { service, calls } = setup();
    await service.remove('u1');
    expect(calls).toEqual(['update', 'delete old']);
  });
});

describe('AvatarService.get', () => {
  it('serves the current version only', async () => {
    const { service, images } = setup('avatars/u1/abc');
    images.get.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(PNG.slice().buffer),
      httpMetadata: { contentType: 'image/png' },
    });
    await expect(service.get('u1', 'abc')).resolves.toMatchObject({ contentType: 'image/png' });
    for (const v of [undefined, 'old', 'ABC']) expect(await statusOf(service.get('u1', v))).toBe(404);
  });

  it('404 without an avatar', async () => {
    const { service } = setup(null);
    expect(await statusOf(service.get('u1', 'abc'))).toBe(404);
  });
});
