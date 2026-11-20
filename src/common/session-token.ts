import { createHash, randomBytes } from 'node:crypto';

/** Only the hash is stored in user_sessions.token_hash; the raw token lives in the cookie. */
export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const newSessionToken = () => randomBytes(32).toString('base64url');
