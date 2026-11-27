import { Controller, Delete, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { uuidParam } from '../../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { BoardsService } from './boards.service';

@ApiTags('boards')
@Controller('boards/:boardId')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Put('star')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Starred (also when it already was).' })
  @ApiResponse({ status: 404, description: 'BOARD_NOT_FOUND: unknown, closed, or not visible to the caller' })
  star(@CurrentUser() user: SessionUser, @Param('boardId', uuidParam('boardId')) boardId: string) {
    return this.boards.star(user.id, boardId);
  }

  @Delete('star')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Not starred any more (also when it was not).' })
  unstar(@CurrentUser() user: SessionUser, @Param('boardId', uuidParam('boardId')) boardId: string) {
    return this.boards.unstar(user.id, boardId);
  }

  @Post('views')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'The board is now the most recently viewed for the caller.' })
  @ApiResponse({ status: 404, description: 'BOARD_NOT_FOUND: unknown, closed, or not visible to the caller' })
  recordView(@CurrentUser() user: SessionUser, @Param('boardId', uuidParam('boardId')) boardId: string) {
    return this.boards.recordView(user.id, boardId);
  }
}
