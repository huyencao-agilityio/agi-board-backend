import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { setSessionCookie } from '../../common/session-cookie';
import { hashSessionToken, newSessionToken } from '../../common/session-token';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { SystemRole } from '../../generated/prisma/enums';
import { EmailService, type EmailRecipient } from '../email/email.service';
import type { ResendCodeDto } from './dto/resend-code.dto';
import type { SignInDto } from './dto/sign-in.dto';
import type { SignUpDto } from './dto/sign-up.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationService, isUniqueConflict } from './email-verification.service';
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
    private readonly verification: EmailVerificationService,
    private readonly email: EmailService,
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
    if (!user.emailVerifiedAt) {
      // No session before the email is verified (BRD decision #38): the code screen comes first.
      if (await this.verification.claim(user.email)) await this.sendCode(user);
      return this.toResult(user);
    }
    return this.createSession(user, req, res);
  }

  /** Same answer for a new email and for one with a password account; nothing is signed in before verification. */
  async signUp(dto: SignUpDto): Promise<{ next: 'verify-email' }> {
    // Before the lookup, so every case pays for it.
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { passwordHash: true },
    });
    if (user && !user.passwordHash) {
      throw new ConflictException({
        code: 'GOOGLE_ONLY_EMAIL',
        message: 'This email uses Google sign-in. Use "Continue with Google" instead.',
      });
    }

    // Before the user is created, so a parallel sign-up that finds the user is refused here.
    const claimed = await this.verification.claim(dto.email);
    const created = user ? null : await this.createUnverifiedUser(dto, passwordHash);
    if (created) {
      // Without a claim someone asked for a code moments ago; the person resends once the cooldown ends.
      if (claimed) await this.sendCode(created);
    } else if (claimed) {
      await this.signUpAgain(dto, passwordHash);
    }
    return { next: 'verify-email' };
  }

  /** The code proves who holds the mailbox, so the password sent with it becomes the account's password. */
  async verifyEmail(dto: VerifyEmailDto, req: Request, res: Response): Promise<SignInResult> {
    const attempt = await this.verification.attempt(dto.email);
    if (attempt === 'locked') {
      throw new HttpException({ code: 'CODE_LOCKED', message: 'Too many attempts. Request a new code.' }, 429);
    }
    if (attempt === 'expired') {
      throw new BadRequestException({
        code: 'CODE_EXPIRED',
        message: 'This code has expired. Request a new code.',
      });
    }

    const incorrect = () => new BadRequestException({ code: 'INCORRECT_CODE', message: 'Incorrect code.' });
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
    if (!user || user.emailVerifiedAt || !user.passwordHash) throw incorrect();
    if (!(await this.verification.consume(user.id, dto.code))) throw incorrect();
    if (user.deactivatedAt) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated. Contact your administrator.',
      });
    }

    const emailVerifiedAt = new Date();
    // Whatever an earlier sign-up stored is replaced here: it may come from a stranger who used this email first.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null, deactivatedAt: null, passwordHash: { not: null } },
      data: { emailVerifiedAt, passwordHash: await this.passwords.hash(dto.password) },
    });
    if (count === 0) throw incorrect();
    await this.prisma.userSession.updateMany({
      where: { userId: user.id, endedAt: null },
      data: { endedAt: emailVerifiedAt, endReason: 'password_reset' },
    });
    return this.createSession({ ...user, emailVerifiedAt }, req, res);
  }

  /** Always the same answer; only an unverified password account gets a code. */
  async resendCode(dto: ResendCodeDto): Promise<{ sent: true }> {
    if (!(await this.verification.claim(dto.email))) {
      throw new HttpException({ code: 'RESEND_TOO_SOON', message: 'Wait before requesting a new code.' }, 429);
    }
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true, deactivatedAt: true },
    });
    if (user?.passwordHash && !user.emailVerifiedAt && !user.deactivatedAt) await this.sendCode(user);
    return { sent: true };
  }

  /** Null when a parallel sign-up (or Google) created the account first. */
  private async createUnverifiedUser(dto: SignUpDto, passwordHash: string): Promise<EmailRecipient | null> {
    try {
      return await this.prisma.user.create({
        data: { email: dto.email, fullName: dto.fullName, passwordHash },
        select: { id: true, email: true },
      });
    } catch (err) {
      if (isUniqueConflict(err)) return null;
      throw err;
    }
  }

  /** An account exists. Unverified: the new password and name replace the old ones (#364) and a new code is sent. */
  private async signUpAgain(dto: SignUpDto, passwordHash: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { email: dto.email },
      select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true, deactivatedAt: true },
    });
    if (!user.passwordHash) return; // Google created it meanwhile
    if (user.emailVerifiedAt || user.deactivatedAt) return this.email.sendAccountExists(user);
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null, deactivatedAt: null, passwordHash: { not: null } },
      data: { passwordHash, fullName: dto.fullName },
    });
    if (count === 1) await this.sendCode(user);
  }

  private async sendCode(user: EmailRecipient) {
    const code = await this.verification.issueCode(user.id);
    if (code) this.email.sendVerificationCode(user, code);
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
    return this.toResult(user);
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
    return this.toResult(user);
  }

  private toResult(user: SignedInUser): SignInResult {
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, systemRole: user.systemRole },
      next: user.emailVerifiedAt ? 'home' : 'verify-email',
    };
  }
}
