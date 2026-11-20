import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF. Safe requests receive a readable `csrf_token` cookie if missing;
 * every write must echo it in the `X-CSRF-Token` header. Applies to @Public routes too.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const cookie = (req.cookies as Record<string, string | undefined>)[CSRF_COOKIE];

    if (SAFE_METHODS.has(req.method)) {
      if (!cookie) {
        http.getResponse<Response>().cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
        });
      }
      return true;
    }

    const header = req.get(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header)) {
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'Missing or invalid CSRF token' });
    }
    return true;
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
