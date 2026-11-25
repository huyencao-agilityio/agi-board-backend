import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { GoogleAuthController } from './google/google-auth.controller';
import { GoogleOAuthService } from './google/google-oauth.service';
import { GoogleSignInService } from './google/google-sign-in.service';
import { PasswordResetService } from './password-reset/password-reset.service';
import { PasswordService } from './password/password.service';
import { SendCooldownService } from './send-cooldown.service';
import { SessionService } from './session/session.service';
import { SignInThrottleService } from './sign-in/sign-in-throttle.service';
import { SignInService } from './sign-in/sign-in.service';
import { EmailVerificationService } from './sign-up/email-verification.service';
import { SignUpService } from './sign-up/sign-up.service';

@Module({
  imports: [EmailModule],
  controllers: [AuthController, GoogleAuthController],
  providers: [
    EmailVerificationService,
    GoogleOAuthService,
    GoogleSignInService,
    PasswordResetService,
    PasswordService,
    SendCooldownService,
    SessionService,
    SignInService,
    SignInThrottleService,
    SignUpService,
  ],
})
export class AuthModule {}
