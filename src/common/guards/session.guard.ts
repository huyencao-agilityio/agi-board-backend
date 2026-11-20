import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { SystemRole } from '../../generated/prisma/enums';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { SYSTEM_ROLES } from '../decorators/require-system-role.decorator';
import { hashSessionToken } from '../session-token';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  systemRole: SystemRole;
  sessionId: string;
}

export type RequestWithUser = Request & { user?: SessionUser };

/** Global guard: every route needs a live session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const token = (req.cookies as Record<string, string | undefined>)[
      this.config.get('SESSION_COOKIE_NAME', { infer: true })
    ];
    if (!token) throw new UnauthorizedException();

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.endedAt || session.user.deactivatedAt) throw new UnauthorizedException();

    const { user } = session;
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      systemRole: user.systemRole,
      sessionId: session.id,
    };

    const roles = this.reflector.getAllAndOverride<SystemRole[] | undefined>(SYSTEM_ROLES, targets);
    if (roles && !roles.includes(user.systemRole)) throw new ForbiddenException();
    return true;
  }
}
