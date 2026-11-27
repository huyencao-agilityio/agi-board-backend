import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { uuidParam } from '../../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { CreateBoardDto } from './dto/create-board.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  @ApiResponse({ status: 201, description: 'The new workspace tile; the caller is its admin.' })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED (name missing, blank after line breaks are replaced and trimmed, over 100 characters, unknown field)',
  })
  create(@CurrentUser() user: SessionUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user, dto.name);
  }

  @Post(':workspaceId/boards')
  @ApiResponse({ status: 201, description: 'The new board tile; the caller is its admin.' })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED (name missing, blank after trim or over 512 characters, visibility not workspace|private, unknown field, bad id)',
  })
  @ApiResponse({
    status: 403,
    description: 'BOARD_CREATE_FORBIDDEN: the caller can see the workspace but is not its admin',
  })
  @ApiResponse({ status: 404, description: 'WORKSPACE_NOT_FOUND: unknown, archived, or not visible to the caller' })
  createBoard(
    @CurrentUser() user: SessionUser,
    @Param('workspaceId', uuidParam('workspaceId')) workspaceId: string,
    @Body() dto: CreateBoardDto,
  ) {
    return this.workspaces.createBoard(user, workspaceId, dto);
  }

  @Get(':workspaceId')
  @ApiResponse({ status: 200, description: 'The workspace tile with the boards the caller can access.' })
  @ApiResponse({ status: 404, description: 'WORKSPACE_NOT_FOUND: unknown, archived, or not visible to the caller' })
  findOne(@CurrentUser() user: SessionUser, @Param('workspaceId', uuidParam('workspaceId')) workspaceId: string) {
    return this.workspaces.findOne(user.id, workspaceId);
  }
}
