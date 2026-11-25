import { BadRequestException, ConflictException, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isUniqueConflict } from '../../../database/prisma-errors';
import { PrismaService } from '../../../database/prisma.service';
import type { User } from '../../../generated/prisma/client';
import type { EmailRecipient } from '../../email/email.service';
import { accountDeactivated } from '../auth-errors';
import { passwordUserSelect } from '../auth-user.select';
import type { ResendCodeDto } from '../dto/resend-code.dto';
import type { SignUpDto } from '../dto/sign-up.dto';
import type { VerifyEmailDto } from '../dto/verify-email.dto';
import { PasswordService } from '../password/password.service';
import { SessionService, type SignInResult } from '../session/session.service';
import { EmailVerificationService } from './email-verification.service';

const verificationSelect = {
  id: true,
  email: true,
  passwordHash: true,
  emailVerifiedAt: true,
  deactivatedAt: true,
} as const;

/** A password account whose email nobody has proven to own yet. */
function awaitsVerification(user: Pick<User, 'passwordHash' | 'emailVerifiedAt' | 'deactivatedAt'>) {
  return !!user.passwordHash && !user.emailVerifiedAt && !user.deactivatedAt;
}

const emailAlreadyExists = () =>
  new ConflictException({
    code: 'EMAIL_ALREADY_EXISTS',
    message: 'An account with this email already exists. Sign in instead.',
  });

@Injectable()
export class SignUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly verification: EmailVerificationService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Creates an unverified account, or lets an unverified one sign up again. Any other existing account (verified,
   * Google-only or deactivated) is refused: the owner chose a clear message over hiding accounts (plan.md D9).
   */
  async signUp(dto: SignUpDto): Promise<{ next: 'verify-email' }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { passwordHash: true, emailVerifiedAt: true, deactivatedAt: true },
    });
    if (user && !awaitsVerification(user)) throw emailAlreadyExists();

    const passwordHash = await this.passwords.hash(dto.password);
    // Before the user is created, so a parallel sign-up that finds the user is refused here.
    const claimed = await this.verification.claim(dto.email);
    const created = user ? null : await this.createUnverifiedUser(dto, passwordHash);
    if (created) {
      // Without a claim someone asked for a code moments ago; the person resends once the cooldown ends.
      if (claimed) await this.verification.sendCode(created);
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
      select: passwordUserSelect,
    });
    if (!user || user.emailVerifiedAt || !user.passwordHash) throw incorrect();
    if (!(await this.verification.consume(user.id, dto.code))) throw incorrect();
    if (user.deactivatedAt) throw accountDeactivated();

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
    return this.sessions.createSession({ ...user, emailVerifiedAt }, req, res);
  }

  /** Always the same answer; only an unverified password account gets a code. */
  async resendCode(dto: ResendCodeDto): Promise<{ sent: true }> {
    if (!(await this.verification.claim(dto.email))) {
      throw new HttpException({ code: 'RESEND_TOO_SOON', message: 'Wait before requesting a new code.' }, 429);
    }
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: verificationSelect,
    });
    if (user && awaitsVerification(user)) await this.verification.sendCode(user);
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

  /** An account exists, so far unverified: the new password and name replace the old ones (#364) and a new code is sent. */
  private async signUpAgain(dto: SignUpDto, passwordHash: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { email: dto.email },
      select: verificationSelect,
    });
    // Verified, deactivated or taken over by Google since the first lookup.
    if (!awaitsVerification(user)) throw emailAlreadyExists();
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null, deactivatedAt: null, passwordHash: { not: null } },
      data: { passwordHash, fullName: dto.fullName },
    });
    if (count === 0) throw emailAlreadyExists();
    await this.verification.sendCode(user);
  }
}
