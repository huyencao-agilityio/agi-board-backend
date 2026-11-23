import { ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { setSessionCookie } from '../../common/session-cookie';
import { hashSessionToken, newSessionToken } from '../../common/session-token';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { SystemRole } from '../../generated/prisma/enums';
import type { SignInDto } from './dto/sign-in.dto';
import type { GoogleProfile } from './google-oauth.service';
import { PasswordService } from './password.service';
import { SignInThrottleService } from './sign-in-throttle.service';

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
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly passwords: PasswordService,
    private readonly throttle: SignInThrottleService,
  ) {}

  async signIn(dto: SignInDto, req: Request, res: Response): Promise<SignInResult> {
    // Counts the attempt first (atomic), so parallel guesses cannot all be verified.
    if (!(await this.throttle.attempt(dto.email))) {
      throw new HttpException({ code: 'SIGN_IN_LOCKED', message: 'Too many attempts. Try again in 15 minutes.' }, 429);
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        fullName: true,
        systemRole: true,
        emailVerifiedAt: true,
        deactivatedAt: true,
        passwordHash: true,
      },
    });

    // An unknown email or a Google-only account still pays for one derivation, so timing does not tell them apart.
    const passwordOk = user?.passwordHash
      ? await this.passwords.verify(dto.password, user.passwordHash)
      : await this.passwords.verifyDummy(dto.password);
    if (!user || !passwordOk) {
      await this.throttle.recordFailure(dto.email);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    // A correct password clears the count, including for a deactivated account (the guess is no longer a failure).
    await this.throttle.reset(dto.email);
    if (user.deactivatedAt) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated. Contact your administrator.',
      });
    }
    return this.createSession(user, req, res);
  }

  /**
   * Finds the account of a verified Google profile (by Google id, then by email, which links a password account
   * to Google with no message) or creates it, then signs it in. A deactivated account is refused.
   */
  async signInWithGoogle(profile: GoogleProfile, req: Request, res: Response): Promise<SignInResult> {
    const select = {
      id: true,
      email: true,
      fullName: true,
      systemRole: true,
      emailVerifiedAt: true,
      deactivatedAt: true,
      googleSubject: true,
    } as const;
    let user =
      (await this.prisma.user.findUnique({ where: { googleSubject: profile.sub }, select })) ??
      (await this.prisma.user.findUnique({ where: { email: profile.email }, select }));

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          fullName: profile.name ?? profile.email.split('@')[0],
          googleSubject: profile.sub,
          emailVerifiedAt: new Date(),
        },
        select,
      });
    } else if (!user.googleSubject) {
      // Pre-hijack guard: an account whose email was never verified may have been registered by someone else, so
      // linking drops its password and ends its sessions; only the Google owner of the email keeps access.
      const unverified = !user.emailVerifiedAt;
      if (unverified) {
        await this.prisma.userSession.updateMany({
          where: { userId: user.id, endedAt: null },
          data: { endedAt: new Date(), endReason: 'password_reset' },
        });
      }
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleSubject: profile.sub,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          ...(unverified ? { passwordHash: null } : {}),
        },
        select,
      });
    } else if (user.googleSubject !== profile.sub) {
      throw new UnauthorizedException({ code: 'GOOGLE_ACCOUNT_MISMATCH', message: 'Google sign-in failed.' });
    }

    if (user.deactivatedAt) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated. Contact your administrator.',
      });
    }
    return this.createSession(user, req, res);
  }

  /** The signed-in user (the session guard already checked the session), shaped like a sign-in result. */
  async me(userId: string): Promise<SignInResult> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, systemRole: true, emailVerifiedAt: true },
    });
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, systemRole: user.systemRole },
      next: user.emailVerifiedAt ? 'home' : 'verify-email',
    };
  }

  /** Stores a session (only the token hash) and sets the cookie that carries the raw token. */
  async createSession(user: SignedInUser, req: Request, res: Response): Promise<SignInResult> {
    const token = newSessionToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastSignInAt: new Date(),
        sessions: {
          create: {
            tokenHash: hashSessionToken(token),
            userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
            ipAddress: req.get('cf-connecting-ip') ?? req.ip ?? null,
          },
        },
      },
      select: { id: true },
    });
    setSessionCookie(res, this.config, token);
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, systemRole: user.systemRole },
      next: user.emailVerifiedAt ? 'home' : 'verify-email',
    };
  }
}
