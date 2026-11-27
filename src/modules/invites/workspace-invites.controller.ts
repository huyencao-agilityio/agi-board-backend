import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { uuidParam } from '../../common/pipes/uuid-param.pipe';
import { CreateInviteDto } from './dto/create-invite.dto';
import { ListInvitesDto } from './dto/list-invites.dto';
import { InvitesService } from './invites.service';

/** The workspace admin's side of workspace invites (specs/21). */
@ApiTags('invites')
@ApiResponse({
  status: 403,
  description: 'INVITE_MANAGE_FORBIDDEN: the caller can see the workspace but is not its admin',
})
@ApiResponse({ status: 404, description: 'WORKSPACE_NOT_FOUND: unknown, archived, or not visible to the caller' })
@Controller('workspaces/:workspaceId/invites')
export class WorkspaceInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  @ApiResponse({ status: 201, description: 'The pending invite; the email is queued.' })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED (bad email, over 254 characters, role not admin|member)',
  })
  @ApiResponse({
    status: 409,
    description: 'ALREADY_MEMBER, or INVITE_PENDING (a pending invite exists, expired or not)',
  })
  @ApiResponse({
    status: 429,
    description:
      'RESEND_COOLDOWN (same address here within 60 s; details.retryAfterSeconds) or INVITE_RATE_LIMITED (50/hour)',
  })
  create(
    @CurrentUser() user: SessionUser,
    @Param('workspaceId', uuidParam('workspaceId')) workspaceId: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.invites.create(user, workspaceId, dto);
  }

  @Get()
  @ApiResponse({ status: 200, description: '{ items, nextCursor }: pending workspace invites, newest first.' })
  list(
    @CurrentUser() user: SessionUser,
    @Param('workspaceId', uuidParam('workspaceId')) workspaceId: string,
    @Query() query: ListInvitesDto,
  ) {
    return this.invites.list(user, workspaceId, query);
  }

  @Post(':inviteId/resend')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'Expiry reset to 14 days; the email is queued.' })
  @ApiResponse({ status: 404, description: 'INVITE_NOT_FOUND: unknown, not a workspace invite here, or answered' })
  @ApiResponse({ status: 429, description: 'RESEND_COOLDOWN within 60 seconds; details.retryAfterSeconds' })
  resend(
    @CurrentUser() user: SessionUser,
    @Param('workspaceId', uuidParam('workspaceId')) workspaceId: string,
    @Param('inviteId', uuidParam('inviteId')) inviteId: string,
  ) {
    return this.invites.resend(user, workspaceId, inviteId);
  }

  @Delete(':inviteId')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Revoked (expired invites too).' })
  @ApiResponse({ status: 404, description: 'INVITE_NOT_FOUND: unknown, not a workspace invite here, or answered' })
  revoke(
    @CurrentUser() user: SessionUser,
    @Param('workspaceId', uuidParam('workspaceId')) workspaceId: string,
    @Param('inviteId', uuidParam('inviteId')) inviteId: string,
  ) {
    return this.invites.revoke(user, workspaceId, inviteId);
  }
}
