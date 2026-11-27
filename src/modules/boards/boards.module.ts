import { Module } from '@nestjs/common';
import { BoardBackgroundsController } from './board-backgrounds.controller';
import { BoardBackgroundsService } from './board-backgrounds.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  controllers: [BoardsController, BoardBackgroundsController],
  providers: [BoardsService, BoardBackgroundsService],
})
export class BoardsModule {}
