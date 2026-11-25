import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { accountDeactivated } from '../auth-errors';
import { signedInUserSelect } from '../auth-user.select';
import { SessionService, type SignInResult } from '../session/session.service';
import { GoogleOAuthService, type GoogleProfile } from './google-oauth.service';

export interface GoogleCallback {
  code: string | undefined;
  state: string | undefined;
  error: string | undefined;
  /** The OAUTH_COOKIE value set when the flow started. */
  cookie: string | undefined;
}

@Injectable()
export class GoogleSignInService {
  private readonly logger = new Logger(GoogleSignInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleOAuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Signs the person in and returns the frontend path to go to, for every outcome. */
  async handleCallback({ code, state, error, cookie }: GoogleCallback, req: Request, res: Response): Promise<string> {
    // The user closed the window or declined: back to the sign-in screen as it was, with no message.
    if (error === 'access_denied') return '/sign-in';

    let profile;
    try {
      profile = await this.oauth.authenticate(code, state, cookie);
    } catch (err) {
      // Our own messages ("State mismatch", "Bad audience", ...): they never hold the code, the token or the profile.
      this.logger.warn(`Google sign-in failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return '/sign-in?error=google_failed';
    }

    try {
      const result = await this.signIn(profile, req, res);
      return result.next === 'home' ? '/home' : '/verify-email';
    } catch (err) {
      if (err instanceof ForbiddenException) return '/sign-in?error=account_deactivated';
      // Database errors can quote the query parameters (the email), so only the error class is logged.
      this.logger.warn(`Google sign-in failed while signing in: ${err instanceof Error ? err.name : 'unknown error'}`);
      return '/sign-in?error=google_failed';
    }
  }

  /**
   * Finds the account of a verified Google profile (by Google id, then by email, which links a password account
   * to Google with no message) or creates it, then signs it in. A deactivated account is refused.
   */
  async signIn(profile: GoogleProfile, req: Request, res: Response): Promise<SignInResult> {
    const select = { ...signedInUserSelect, deactivatedAt: true, googleSubject: true } as const;
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
        // Only if nothing changed since the read (a verification may run now); otherwise the person tries again.
        where: { id: user.id, AND: { googleSubject: null, emailVerifiedAt: unverified ? null : { not: null } } },
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

    if (user.deactivatedAt) throw accountDeactivated();
    return this.sessions.createSession(user, req, res);
  }
}
