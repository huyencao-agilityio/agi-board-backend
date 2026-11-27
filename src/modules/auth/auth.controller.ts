import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { uuidParam } from '../../common/pipes/uuid-param.pipe';
import { Public } from '../../common/decorators/public.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import { AccountSecurityService } from './account/account-security.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CheckResetLinkDto } from './dto/check-reset-link.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { PasswordResetService } from './password-reset/password-reset.service';
import { SessionService } from './session/session.service';
import { SignInService } from './sign-in/sign-in.service';
import { SignUpService } from './sign-up/sign-up.service';

const sessionIdPipe = uuidParam('sessionId');

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly signInService: SignInService,
    private readonly signUpService: SignUpService,
    private readonly passwordReset: PasswordResetService,
    private readonly sessions: SessionService,
    private readonly accountSecurity: AccountSecurityService,
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

  // Public: a person who forgot the password has no session. CSRF still applies to this write.
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'Generic answer for every email, also within 60 seconds of the last one.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.forgotPassword(dto);
  }

  // Public: the link is opened without a session. A POST, so the token stays out of the URL and the logs.
  @Public()
  @Post('reset-password/check')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'Valid link; the `email` of its account. The link is not used up.' })
  @ApiResponse({ status: 400, description: 'RESET_LINK_INVALID or VALIDATION_FAILED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  checkResetLink(@Body() dto: CheckResetLinkDto) {
    return this.passwordReset.checkLink(dto);
  }

  // Public: the link is the proof, there is no session. CSRF still applies to this write.
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'Password replaced and all sessions ended; no session cookie.' })
  @ApiResponse({ status: 400, description: 'RESET_LINK_INVALID, or VALIDATION_FAILED (the link stays valid)' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordReset.resetPassword(dto);
  }

  @Get('me')
  @ApiResponse({ status: 200, description: 'The signed-in user, same shape as sign-in (`user` + `next`).' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED when it was ended or expired' })
  me(@CurrentUser() user: SessionUser) {
    return this.sessions.me(user.id);
  }

  // Public so an already-ended session still gets 204; the service requires a known session cookie. CSRF still applies.
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Session ended (or already ended); session and CSRF cookies cleared.' })
  @ApiResponse({ status: 401, description: 'No session cookie, or a token matching no session' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.sessions.logout(req, res);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Password replaced; other sessions ended, this one stays signed in.' })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED (rules in `details`), PASSWORD_NOT_SET (Google-only) or CURRENT_PASSWORD_INCORRECT',
  })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  @ApiResponse({ status: 429, description: 'CHANGE_PASSWORD_LOCKED after 5 wrong current passwords, for 15 minutes' })
  changePassword(@CurrentUser() user: SessionUser, @Body() dto: ChangePasswordDto) {
    return this.accountSecurity.changePassword(user, dto);
  }

  @Get('sessions')
  @ApiResponse({
    status: 200,
    description: '`items`: live sessions (id, userAgent, createdAt, lastActiveAt, isCurrent)',
  })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  listSessions(@CurrentUser() user: SessionUser) {
    return this.accountSecurity.listSessions(user);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'That session ended; its device gets SESSION_ENDED.' })
  @ApiResponse({ status: 400, description: 'CURRENT_SESSION (use logout) or VALIDATION_FAILED (not a UUID)' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  @ApiResponse({ status: 404, description: 'SESSION_NOT_FOUND (unknown, ended or not yours)' })
  endSession(@CurrentUser() user: SessionUser, @Param('sessionId', sessionIdPipe) sessionId: string) {
    return this.accountSecurity.endSession(user, sessionId);
  }

  @Delete('sessions')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Every other live session ended (also when there were none).' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  endOtherSessions(@CurrentUser() user: SessionUser) {
    return this.accountSecurity.endOtherSessions(user);
  }
}
