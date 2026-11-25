import { HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { accountDeactivated, invalidCredentials } from '../auth-errors';
import { passwordUserSelect } from '../auth-user.select';
import type { SignInDto } from '../dto/sign-in.dto';
import { PasswordService } from '../password/password.service';
import { SessionService, type SignInResult } from '../session/session.service';
import { EmailVerificationService } from '../sign-up/email-verification.service';
import { SignInThrottleService } from './sign-in-throttle.service';

@Injectable()
export class SignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: SignInThrottleService,
    private readonly verification: EmailVerificationService,
    private readonly sessions: SessionService,
  ) {}

  async signIn(dto: SignInDto, req: Request, res: Response): Promise<SignInResult> {
    // Counts the attempt first (atomic), so parallel guesses cannot all be verified.
    if (!(await this.throttle.attempt(dto.email))) {
      throw new HttpException({ code: 'SIGN_IN_LOCKED', message: 'Too many attempts. Try again in 15 minutes.' }, 429);
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: passwordUserSelect,
    });

    // An unknown email or a Google-only account still pays for one derivation, so timing does not tell them apart.
    const passwordOk = user?.passwordHash
      ? await this.passwords.verify(dto.password, user.passwordHash)
      : await this.passwords.verifyDummy(dto.password);
    if (!user || !passwordOk) {
      await this.throttle.recordFailure(dto.email);
      throw invalidCredentials();
    }
    // A correct password clears the count, including for a deactivated account (the guess is no longer a failure).
    await this.throttle.reset(dto.email);
    if (user.deactivatedAt) throw accountDeactivated();
    if (!user.emailVerifiedAt) {
      // No session before the email is verified (BRD decision #38): the code screen comes first.
      if (await this.verification.claim(user.email)) await this.verification.sendCode(user);
      return this.sessions.toResult(user);
    }
    return this.sessions.createSession(user, req, res, user.passwordHash);
  }
}
