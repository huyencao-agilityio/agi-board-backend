import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithUser, SessionUser } from '../guards/session.guard';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest<RequestWithUser>().user!,
);
