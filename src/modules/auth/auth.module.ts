import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { PasswordService } from './password.service';
import { SignInThrottleService } from './sign-in-throttle.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, GoogleOAuthService, PasswordService, SignInThrottleService],
  exports: [PasswordService, SignInThrottleService],
})
export class AuthModule {}
