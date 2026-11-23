import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Name of the short-lived cookie that carries `state` and the PKCE verifier between the two redirects. */
export const OAUTH_COOKIE = 'agi_oauth';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
}

/**
 * Checks the claims of an id_token received straight from Google's token endpoint over TLS, which is why the
 * signature is not verified (OpenID Connect Core 3.1.3.7). Throws when any check fails.
 */
export function parseIdToken(idToken: string, clientId: string, now = new Date()): GoogleProfile {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('Malformed id_token');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;

  if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) throw new Error('Bad issuer');
  if (claims.aud !== clientId) throw new Error('Bad audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) throw new Error('Expired id_token');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Email not verified');
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new Error('Missing claims');

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
  };
}

/** Authorization-code flow with PKCE, written with fetch (no OAuth library; see specs/4/research.md R2). */
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get settings() {
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET', { infer: true });
    const redirectUri = this.config.get('GOOGLE_REDIRECT_URI', { infer: true });
    return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
  }

  isConfigured() {
    return this.settings !== null;
  }

  /** The consent-page URL, plus the value to keep in the OAUTH_COOKIE until the callback. */
  start(): { url: string; cookie: string } {
    const s = this.settings;
    if (!s) throw new Error('Google sign-in is not configured');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: s.clientId,
      redirect_uri: s.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), cookie: `${state}.${verifier}` };
  }

  /** Checks `state`, trades the code for an id_token and returns the verified profile. Throws on any failure. */
  async authenticate(code: string | undefined, state: string | undefined, cookie: string | undefined) {
    const s = this.settings;
    const [expectedState, verifier] = cookie?.split('.') ?? [];
    if (!s || !code || !state || !expectedState || !verifier) throw new Error('Missing OAuth parameters');
    const a = Buffer.from(state);
    const b = Buffer.from(expectedState);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('State mismatch');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: s.clientId,
        client_secret: s.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: s.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed with ${res.status}`);
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string') throw new Error('No id_token in the token response');
    return parseIdToken(body.id_token, s.clientId);
  }
}
