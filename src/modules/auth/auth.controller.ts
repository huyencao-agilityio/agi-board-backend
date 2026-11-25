import { Body, Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { SessionUser } from '../../common/guards/session.guard';
import type { Env } from '../../config/env';
import { AuthService } from './auth.service';
import { ResendCodeDto } from './dto/resend-code.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleOAuthService, OAUTH_COOKIE } from './google-oauth.service';

const OAUTH_COOKIE_MINUTES = 10;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleOAuthService,
    private readonly config: ConfigService<Env, true>,
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
    return this.auth.signIn(dto, req, res);
  }

  // Public: a person without an account must reach it. CSRF still applies to this write.
  @Public()
  @Post('sign-up')
  @ApiResponse({ status: 201, description: 'Same for a new email and one with a password account; no session yet.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED, one `details` entry per failed rule' })
  @ApiResponse({ status: 403, description: 'CSRF_INVALID' })
  @ApiResponse({ status: 409, description: 'GOOGLE_ONLY_EMAIL' })
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto);
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
    return this.auth.verifyEmail(dto, req, res);
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
    return this.auth.resendCode(dto);
  }

  @Get('me')
  @ApiResponse({ status: 200, description: 'The signed-in user, same shape as sign-in (`user` + `next`).' })
  @ApiResponse({ status: 401, description: 'No session, or SESSION_ENDED when it was ended or expired' })
  me(@CurrentUser() user: SessionUser) {
    return this.auth.me(user.id);
  }

  // Public: starts the sign-in of a signed-out user. A GET with no side effect besides the state cookie.
  @Public()
  @Get('google')
  @ApiResponse({
    status: 302,
    description: 'Redirect to Google. Not configured: redirect to /sign-in?error=google_failed.',
  })
  startGoogle(@Res() res: Response) {
    if (!this.google.isConfigured()) return this.redirect(res, '/sign-in?error=google_failed');
    const { url, cookie } = this.google.start();
    res.cookie(OAUTH_COOKIE, cookie, this.oauthCookieOptions());
    return res.redirect(302, url);
  }

  // Public: Google sends the browser back here before any session exists. `state` + PKCE guard against forgery.
  // Individual @Query params, not a DTO: Google adds extra parameters that a whitelisting DTO would reject.
  @Public()
  @Get('google/callback')
  @ApiResponse({ status: 302, description: 'Always a redirect to the frontend (/home, /verify-email or /sign-in).' })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookie = (req.cookies as Record<string, string | undefined>)[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, this.oauthCookieOptions());

    // The user closed the window or declined: back to the sign-in screen as it was, with no message.
    if (error === 'access_denied') return this.redirect(res, '/sign-in');

    let profile;
    try {
      profile = await this.google.authenticate(code, state, cookie);
    } catch (err) {
      // Our own messages ("State mismatch", "Bad audience", ...): they never hold the code, the token or the profile.
      this.logger.warn(`Google sign-in failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return this.redirect(res, '/sign-in?error=google_failed');
    }

    try {
      const result = await this.auth.signInWithGoogle(profile, req, res);
      return this.redirect(res, result.next === 'home' ? '/home' : '/verify-email');
    } catch (err) {
      if (err instanceof ForbiddenException) return this.redirect(res, '/sign-in?error=account_deactivated');
      // Database errors can quote the query parameters (the email), so only the error class is logged.
      this.logger.warn(`Google sign-in failed while signing in: ${err instanceof Error ? err.name : 'unknown error'}`);
      return this.redirect(res, '/sign-in?error=google_failed');
    }
  }

  private redirect(res: Response, path: string) {
    return res.redirect(302, `${this.config.get('APP_ORIGIN', { infer: true })}${path}`);
  }

  private oauthCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/api/v1/auth/google',
      maxAge: OAUTH_COOKIE_MINUTES * 60_000,
    };
  }
}
