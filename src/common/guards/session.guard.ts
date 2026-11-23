import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { SystemRole } from '../../generated/prisma/enums';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { SYSTEM_ROLES } from '../decorators/require-system-role.decorator';
import { DAY_MS, setSessionCookie } from '../session-cookie';
import { hashSessionToken } from '../session-token';

/** A session used within this window is not touched, so a busy user does not cost a database write per request. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

/** 401 whose code tells the frontend to sign the user out and show the "You were signed out" notice. */
const sessionEnded = () =>
  new UnauthorizedException({ code: 'SESSION_ENDED', message: 'You were signed out. Sign in again.' });

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  systemRole: SystemRole;
  sessionId: string;
}

export type RequestWithUser = Request & { user?: SessionUser };

/**
 * Global guard: every route needs a live session unless marked @Public(). A session idle for SESSION_IDLE_DAYS
 * expires; one ended by anything except logout answers SESSION_ENDED.
 */
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
    if (!session) throw new UnauthorizedException();
    if (session.endedAt) throw session.endReason === 'logout' ? new UnauthorizedException() : sessionEnded();
    if (session.user.deactivatedAt) throw new UnauthorizedException();

    const now = Date.now();
    const idleDays = this.config.get('SESSION_IDLE_DAYS', { infer: true });
    if (now - session.lastActiveAt.getTime() > idleDays * DAY_MS) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { endedAt: new Date(now), endReason: 'expired' },
        select: { id: true },
      });
      throw sessionEnded();
    }
    if (now - session.lastActiveAt.getTime() > REFRESH_AFTER_MS) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date(now) },
        select: { id: true },
      });
      setSessionCookie(ctx.switchToHttp().getResponse<Response>(), this.config, token);
    }

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
