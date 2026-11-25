import { parseIdToken } from './google-oauth.service';

const CLIENT = 'client-id';
const now = new Date('2026-11-23T10:00:00Z');
const inOneHour = Math.floor(now.getTime() / 1000) + 3600;

const token = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const valid = {
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  exp: inOneHour,
  email_verified: true,
  sub: 'google-sub',
  email: 'User@Example.com',
  name: ' Test User ',
};

describe('parseIdToken', () => {
  it('returns the profile with a lower-cased email and a trimmed name', () => {
    expect(parseIdToken(token(valid), CLIENT, now)).toEqual({
      sub: 'google-sub',
      email: 'user@example.com',
      name: 'Test User',
    });
  });

  it('accepts the issuer without the scheme and a string email_verified', () => {
    expect(() =>
      parseIdToken(token({ ...valid, iss: 'accounts.google.com', email_verified: 'true' }), CLIENT, now),
    ).not.toThrow();
  });

  it('returns a null name when Google sends none', () => {
    expect(parseIdToken(token({ ...valid, name: undefined }), CLIENT, now).name).toBeNull();
  });

  it.each([
    ['wrong issuer', { iss: 'https://evil.example.com' }],
    ['wrong audience', { aud: 'another-client' }],
    ['expired', { exp: Math.floor(now.getTime() / 1000) - 1 }],
    ['unverified email', { email_verified: false }],
    ['missing sub', { sub: undefined }],
    ['missing email', { email: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(() => parseIdToken(token({ ...valid, ...override }), CLIENT, now)).toThrow();
  });

  it('rejects a malformed token', () => {
    expect(() => parseIdToken('not-a-jwt', CLIENT, now)).toThrow();
  });
});
