import { Body, Controller, Delete, Get, HttpCode, Patch, Put, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { AvatarService } from './avatar.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('users')
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly profile: ProfileService,
    private readonly avatar: AvatarService,
  ) {}

  @Get()
  @ApiResponse({ status: 200, description: 'id, email, fullName, avatarUrl, hasPassword, googleLinked' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  getProfile(@CurrentUser() user: SessionUser) {
    return this.profile.getProfile(user.id);
  }

  @Patch()
  @ApiResponse({ status: 200, description: 'The profile with the new name.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED (empty after trim, missing, unknown field)' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  updateProfile(@CurrentUser() user: SessionUser, @Body() dto: UpdateProfileDto) {
    return this.profile.updateName(user.id, dto.fullName);
  }

  @Put('avatar')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 200, description: 'The profile with the new avatarUrl; the previous photo is deleted.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED: not multipart, unreadable, or no `file` field' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  @ApiResponse({ status: 409, description: 'AVATAR_CONFLICT: changed by a parallel request; nothing stored' })
  @ApiResponse({ status: 413, description: 'PAYLOAD_TOO_LARGE: file over 5 MB' })
  @ApiResponse({ status: 415, description: 'UNSUPPORTED_IMAGE_TYPE: not JPEG, PNG, WebP or GIF (by content)' })
  uploadAvatar(@CurrentUser() user: SessionUser, @Req() req: Request) {
    return this.avatar.upload(user.id, req);
  }

  @Delete('avatar')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Photo removed (or there was none).' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  removeAvatar(@CurrentUser() user: SessionUser) {
    return this.avatar.remove(user.id);
  }

  @Get('avatar')
  @ApiResponse({ status: 200, description: 'The image bytes; the `v` query parameter only busts caches.' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 404, description: 'AVATAR_NOT_FOUND' })
  async getAvatar(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    const { body, contentType } = await this.avatar.get(user.id);
    res.set({
      'Content-Type': contentType,
      // Safe to cache for good: a new photo has a new URL (`?v=`).
      'Cache-Control': 'private, max-age=31536000, immutable',
      // helmet's default same-origin would block the frontend on another port or subdomain of the same site.
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    return new StreamableFile(body);
  }
}
