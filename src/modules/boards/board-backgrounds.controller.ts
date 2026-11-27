import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BoardBackgroundsService } from './board-backgrounds.service';

@ApiTags('boards')
@Controller('board-backgrounds/:key')
export class BoardBackgroundsController {
  constructor(private readonly backgrounds: BoardBackgroundsService) {}

  @Get('thumbnail')
  @ApiResponse({ status: 200, description: 'The preset thumbnail image (any signed-in user; not user content).' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 404, description: 'BACKGROUND_NOT_FOUND: unknown preset key' })
  async thumbnail(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    const { body, contentType } = await this.backgrounds.thumbnail(key);
    res.set({
      'Content-Type': contentType,
      // Presets are fixed per key, so a day of caching is safe; private because the route needs a session.
      'Cache-Control': 'private, max-age=86400',
      // helmet's default same-origin would block the frontend on another port or subdomain of the same site.
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    return new StreamableFile(body);
  }
}
