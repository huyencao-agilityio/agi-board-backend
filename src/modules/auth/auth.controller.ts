import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { ResendCodeDto } from './dto/resend-code.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { SessionService } from './session/session.service';
import { SignInService } from './sign-in/sign-in.service';
import { SignUpService } from './sign-up/sign-up.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly signInService: SignInService,
    private readonly signUpService: SignUpService,
    private readonly sessions: SessionService,
  ) {}

  // Public: a signed-out user must reach it. CSRF still applies to this write.
  @Public()
  @Post('sign-in')
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description:
      'Signed in, session cookie set (`next: home`); or unverified: no cookie, a code is emailed (`next: verify-email`).',
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS (same for unknown email and wrong password)' })
  @ApiResponse({ status: 403, description: 'ACCOUNT_DEACTIVATED (correct credentials only) or CSRF_INVALID' })
  @ApiResponse({ status: 429, description: 'SIGN_IN_LOCKED after 5 wrong passwords, for 15 minutes' })
  signIn(@Body() dto: SignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.signInService.signIn(dto, req, res);
  }

  // Public: a person without an account must reach it. CSRF still applies to this write.
  @Public()
  @Post('sign-up')
  @ApiResponse({ status: 201, description: 'New or still unverified account; a code is emailed, no session yet.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED, one `details` entry per failed rule' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_EXISTS (verified, Google or deactivated account)' })
  signUp(@Body() dto: SignUpDto) {
    return this.signUpService.signUp(dto);
  }

  // Public: there is no session before the email is verified. CSRF still applies to this write.
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description: 'Email verified, `password` stored as the account password; session cookie set.',
  })
  @ApiResponse({ status: 400, description: 'INCORRECT_CODE, CODE_EXPIRED or VALIDATION_FAILED' })
  @ApiResponse({ status: 403, description: 'ACCOUNT_DEACTIVATED (right code only) or CSRF_INVALID' })
  @ApiResponse({ status: 429, description: 'CODE_LOCKED after 5 wrong attempts, until a new code is sent' })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.signUpService.verifyEmail(dto, req, res);
  }

  // Public: there is no session before the email is verified. CSRF still applies to this write.
  @Public()
  @Post('resend-code')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'Generic answer; a code is emailed only to an unverified account.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  @ApiResponse({ status: 429, description: 'RESEND_TOO_SOON within 60 seconds of the last send' })
  resendCode(@Body() dto: ResendCodeDto) {
    return this.signUpService.resendCode(dto);
  }

  @Get('me')
  @ApiResponse({ status: 200, description: 'The signed-in user, same shape as sign-in (`user` + `next`).' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED when it was ended or expired' })
  me(@CurrentUser() user: SessionUser) {
    return this.sessions.me(user.id);
  }
}
