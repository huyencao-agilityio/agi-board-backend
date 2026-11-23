import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../config/env';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The session cookie: written at sign-in and renewed by SessionGuard while the user stays active. */
export function setSessionCookie(res: Response, config: ConfigService<Env, true>, token: string) {
  res.cookie(config.get('SESSION_COOKIE_NAME', { infer: true }), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('NODE_ENV', { infer: true }) === 'production',
    path: '/',
    maxAge: config.get('SESSION_IDLE_DAYS', { infer: true }) * DAY_MS,
  });
}
