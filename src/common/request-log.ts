import type { IncomingMessage } from 'node:http';
import { stdSerializers } from 'pino';

const OAUTH_CALLBACK = '/api/v1/auth/google/callback';

/** The part of pino's request log object that this file reads and rewrites. */
export interface LoggedRequest {
  url?: string;
  query?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * pino-http logs the URL and the parsed query of every request. Google's callback carries a one-time `code` and
 * `state` there; they must not reach the logs (security rules: no tokens or codes in logged URLs).
 */
export function serializeRequest(req: IncomingMessage): LoggedRequest {
  const out = stdSerializers.req(req) as unknown as LoggedRequest;
  if (out.url?.startsWith(OAUTH_CALLBACK)) {
    out.url = `${OAUTH_CALLBACK}?redacted`;
    out.query = {};
  }
  return out;
}
