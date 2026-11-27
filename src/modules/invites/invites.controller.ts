import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { uuidParam } from '../../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { InvitesService } from './invites.service';

@ApiTags('invites')
@Controller('invites/:inviteId')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('accept')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: '{ workspaceId, boardId }: where the client goes next.' })
  @ApiResponse({ status: 404, description: 'INVITE_NOT_FOUND: unknown, not for your email, or already answered' })
  @ApiResponse({ status: 409, description: 'INVITE_EXPIRED: past its expiry; it can still be declined' })
  accept(@CurrentUser() user: SessionUser, @Param('inviteId', uuidParam('inviteId')) inviteId: string) {
    return this.invites.accept(user, inviteId);
  }

  @Post('decline')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Declined (expired invites too).' })
  @ApiResponse({ status: 404, description: 'INVITE_NOT_FOUND: unknown, not for your email, or already answered' })
  decline(@CurrentUser() user: SessionUser, @Param('inviteId', uuidParam('inviteId')) inviteId: string) {
    return this.invites.decline(user, inviteId);
  }
}
