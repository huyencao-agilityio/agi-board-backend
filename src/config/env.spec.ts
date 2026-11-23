import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = { APP_ORIGIN: 'http://localhost:5173' };

  it('applies defaults', () => {
    expect(validateEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      SESSION_COOKIE_NAME: 'agi_sid',
    });
  });

  it('defaults SESSION_IDLE_DAYS to 7 and coerces a string', () => {
    expect(validateEnv(valid).SESSION_IDLE_DAYS).toBe(7);
    expect(validateEnv({ ...valid, SESSION_IDLE_DAYS: '3' }).SESSION_IDLE_DAYS).toBe(3);
    expect(() => validateEnv({ ...valid, SESSION_IDLE_DAYS: '0' })).toThrow(/SESSION_IDLE_DAYS/);
  });

  it('does not require Google variables outside production', () => {
    expect(validateEnv(valid).GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('requires the Google variables in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'https://app.example.com/api/v1/auth/google/callback',
      }).GOOGLE_CLIENT_ID,
    ).toBe('id');
  });

  it('defaults PASSWORD_PBKDF2_ITERATIONS to 10000 and rejects a very low value', () => {
    expect(validateEnv(valid).PASSWORD_PBKDF2_ITERATIONS).toBe(10_000);
    expect(validateEnv({ ...valid, PASSWORD_PBKDF2_ITERATIONS: '50000' }).PASSWORD_PBKDF2_ITERATIONS).toBe(50_000);
    expect(() => validateEnv({ ...valid, PASSWORD_PBKDF2_ITERATIONS: '10' })).toThrow(/PASSWORD_PBKDF2_ITERATIONS/);
  });

  it('rejects a missing APP_ORIGIN', () => {
    expect(() => validateEnv({})).toThrow(/APP_ORIGIN/);
  });
});
