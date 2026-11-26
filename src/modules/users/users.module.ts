import { Module } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { ProfileService } from './profile.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [AvatarService, ProfileService],
})
export class UsersModule {}
