import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import type { Env } from '../../../config/env';
import { GoogleOAuthService, OAUTH_COOKIE } from './google-oauth.service';
import { GoogleSignInService } from './google-sign-in.service';

const OAUTH_COOKIE_MINUTES = 10;

@ApiTags('auth')
@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly signIn: GoogleSignInService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // Public: starts the sign-in of a signed-out user. A GET with no side effect besides the state cookie.
  @Public()
  @Get()
  @ApiResponse({
    status: 302,
    description: 'Redirect to Google. Not configured: redirect to /sign-in?error=google_failed.',
  })
  startGoogle(@Res() res: Response) {
    if (!this.oauth.isConfigured()) return this.redirect(res, '/sign-in?error=google_failed');
    const { url, cookie } = this.oauth.start();
    res.cookie(OAUTH_COOKIE, cookie, this.oauthCookieOptions());
    return res.redirect(302, url);
  }

  // Public: Google sends the browser back here before any session exists. `state` + PKCE guard against forgery.
  // Individual @Query params, not a DTO: Google adds extra parameters that a whitelisting DTO would reject.
  @Public()
  @Get('callback')
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

    return this.redirect(res, await this.signIn.handleCallback({ code, state, error, cookie }, req, res));
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
