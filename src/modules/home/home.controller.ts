import { Controller, Get } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { HomeService } from './home.service';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description:
      'starred, recent (6 latest viewed, starred or not), workspaces with accessible boards, pending invites, hasArchivedWorkspaces',
  })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  getHome(@CurrentUser() user: SessionUser) {
    return this.home.getHome(user);
  }
}
