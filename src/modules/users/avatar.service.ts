import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import { getBindings } from '../../cloudflare';
import { PrismaService } from '../../database/prisma.service';
import { AVATAR_MAX_BYTES, detectImageType } from './image-type';
import { type Profile, ProfileService } from './profile.service';
import { AVATAR_BODY_LIMIT, payloadTooLarge, readBody } from './read-body';

const invalidUpload = (message: string) => new BadRequestException({ code: 'VALIDATION_FAILED', message });
const avatarNotFound = () => new NotFoundException({ code: 'AVATAR_NOT_FOUND', message: 'No avatar.' });

/**
 * Avatar in R2 (`IMAGES`): one object per user at `avatars/<userId>/<uuid>`, a new key per upload.
 * The database is updated first, then the old object is deleted; a failed delete is only logged (specs/22 D5).
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
  ) {}

  /** `multipart/form-data` with one file field `file` (specs/22 research D2). */
  async upload(userId: string, req: Request): Promise<Profile> {
    const contentType = req.get('content-type');
    if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
      throw invalidUpload('Send the image as multipart/form-data in the field "file".');
    }
    // A declared size over the limit is refused before reading; readBody still caps a missing or false header.
    if (Number(req.get('content-length')) > AVATAR_BODY_LIMIT) throw payloadTooLarge();
    const body = await readBody(req, AVATAR_BODY_LIMIT);
    if (body.length === 0) throw invalidUpload('The request body is empty.');

    let file: FormDataEntryValue | null;
    try {
      file = (await new Response(body, { headers: { 'content-type': contentType } }).formData()).get('file');
    } catch {
      throw invalidUpload('The multipart body could not be read.');
    }
    if (!(file instanceof File) || file.size === 0) throw invalidUpload('The field "file" must hold a file.');
    if (file.size > AVATAR_MAX_BYTES) throw payloadTooLarge();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_IMAGE_TYPE',
        message: 'Use a JPEG, PNG, WebP or GIF image.',
      });
    }

    const { IMAGES } = getBindings();
    const oldKey = await this.currentKey(userId);
    const newKey = `avatars/${userId}/${crypto.randomUUID()}`;
    await IMAGES.put(newKey, bytes, { httpMetadata: { contentType: type } });
    // Only swaps if no parallel request changed the avatar since `oldKey` was read; otherwise every losing upload
    // would leave an object nobody deletes (a way to fill the bucket on purpose).
    let swapped: number;
    try {
      ({ count: swapped } = await this.prisma.user.updateMany({
        where: { id: userId, avatarObjectKey: oldKey },
        data: { avatarObjectKey: newKey },
      }));
    } catch (err) {
      await this.deleteObject(userId, newKey);
      throw err;
    }
    if (swapped !== 1) {
      await this.deleteObject(userId, newKey);
      throw new ConflictException({
        code: 'AVATAR_CONFLICT',
        message: 'The avatar was changed at the same time. Try again.',
      });
    }
    if (oldKey) await this.deleteObject(userId, oldKey);
    return this.profile.getProfile(userId);
  }

  /** Idempotent: no avatar, nothing to do. */
  async remove(userId: string): Promise<void> {
    const oldKey = await this.currentKey(userId);
    if (!oldKey) return;
    // Conditional like upload: if a parallel upload swapped the key, that photo stays and owns the old object.
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, avatarObjectKey: oldKey },
      data: { avatarObjectKey: null },
    });
    if (count === 1) await this.deleteObject(userId, oldKey);
  }

  async get(userId: string): Promise<{ body: Buffer; contentType: string }> {
    const key = await this.currentKey(userId);
    if (!key) throw avatarNotFound();
    const obj = await getBindings().IMAGES.get(key);
    if (!obj) throw avatarNotFound();
    // shortcut: reads the whole image (≤ 5 MB) into memory; stream it if larger images are ever served.
    return {
      body: Buffer.from(await obj.arrayBuffer()),
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
    };
  }

  private async currentKey(userId: string): Promise<string | null> {
    const { avatarObjectKey } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarObjectKey: true },
    });
    return avatarObjectKey;
  }

  /** Best effort: an orphan object is better than failing a request whose database change already happened. */
  private async deleteObject(userId: string, key: string): Promise<void> {
    try {
      await getBindings().IMAGES.delete(key);
    } catch (err) {
      this.logger.warn(
        `Avatar object ${key} of user ${userId} not deleted: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    }
  }
}
