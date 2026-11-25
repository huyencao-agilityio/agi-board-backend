import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { GoogleOAuthService } from './google-oauth.service';
import { PasswordService } from './password.service';
import { SignInThrottleService } from './sign-in-throttle.service';

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, EmailVerificationService, GoogleOAuthService, PasswordService, SignInThrottleService],
  exports: [PasswordService, SignInThrottleService],
})
export class AuthModule {}
