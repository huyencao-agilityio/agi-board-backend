import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { setSessionCookie } from '../../../common/session-cookie';
import { hashSessionToken, newSessionToken } from '../../../common/session-token';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../database/prisma.service';
import type { SystemRole } from '../../../generated/prisma/enums';
import { invalidCredentials } from '../auth-errors';
import { signedInUserSelect } from '../auth-user.select';

export interface SignedInUser {
  id: string;
  email: string;
  fullName: string;
  systemRole: SystemRole;
  emailVerifiedAt: Date | null;
}

export interface SignInResult {
  user: Pick<SignedInUser, 'id' | 'email' | 'fullName' | 'systemRole'>;
  /** Where the frontend goes next: `home` is WEB-03, `verify-email` is WEB-16. */
  next: 'home' | 'verify-email';
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The signed-in user (the session guard already checked the session), shaped like a sign-in result. */
  async me(userId: string): Promise<SignInResult> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: signedInUserSelect,
    });
    return this.toResult(user);
  }

  /**
   * Stores a session (only the token hash) and sets the cookie that carries the raw token. With `verifiedHash`, the
   * password hash this sign-in checked, the session is refused when the password was replaced meanwhile.
   */
  async createSession(
    user: SignedInUser,
    req: Request,
    res: Response,
    verifiedHash?: string | null,
  ): Promise<SignInResult> {
    const token = newSessionToken();
    const tokenHash = hashSessionToken(token);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastSignInAt: new Date(),
        sessions: {
          create: {
            tokenHash,
            userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
            ipAddress: req.get('cf-connecting-ip') ?? req.ip ?? null,
          },
        },
      },
      select: { id: true },
    });
    if (verifiedHash !== undefined) await this.refuseIfPasswordChanged(user.id, verifiedHash, tokenHash);
    setSessionCookie(res, this.config, token);
    return this.toResult(user);
  }

  /** Checked after the session is stored: a reset before that is seen here, a reset after it ends the session itself. */
  private async refuseIfPasswordChanged(userId: string, verifiedHash: string | null, tokenHash: string) {
    const { passwordHash } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (passwordHash === verifiedHash) return;
    await this.prisma.userSession.updateMany({
      where: { tokenHash, endedAt: null },
      data: { endedAt: new Date(), endReason: 'password_reset' },
    });
    throw invalidCredentials();
  }

  toResult(user: SignedInUser): SignInResult {
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, systemRole: user.systemRole },
      next: user.emailVerifiedAt ? 'home' : 'verify-email',
    };
  }
}
