import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { WorkspaceInvitesController } from './workspace-invites.controller';

@Module({
  imports: [EmailModule],
  controllers: [InvitesController, WorkspaceInvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
