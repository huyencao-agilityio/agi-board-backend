import { Injectable, NotFoundException } from '@nestjs/common';
import { getBindings } from '../../cloudflare';
import { PrismaService } from '../../database/prisma.service';

const backgroundNotFound = () =>
  new NotFoundException({ code: 'BACKGROUND_NOT_FOUND', message: 'Background not found' });

/** The seeded preset backgrounds (`board_backgrounds`): system images, not user content. */
@Injectable()
export class BoardBackgroundsService {
  constructor(private readonly prisma: PrismaService) {}

  async thumbnail(key: string): Promise<{ body: Buffer; contentType: string }> {
    const background = await this.prisma.boardBackground.findUnique({
      where: { id: key },
      select: { thumbnailObjectKey: true },
    });
    if (!background) throw backgroundNotFound();
    const obj = await getBindings().IMAGES.get(background.thumbnailObjectKey);
    if (!obj) throw backgroundNotFound();
    // shortcut: reads the whole thumbnail (a few KB) into memory, like avatars; stream it if large images are served.
    return {
      body: Buffer.from(await obj.arrayBuffer()),
      contentType: obj.httpMetadata?.contentType ?? 'image/jpeg',
    };
  }
}
