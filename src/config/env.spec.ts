import { docsEnabled, validateEnv } from './env';

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
    expect(() => validateEnv({ ...valid, SESSION_IDLE_DAYS: '31' })).toThrow(/SESSION_IDLE_DAYS/);
  });

  it('turns docs on outside production and when ENABLE_DOCS=true', () => {
    expect(docsEnabled('development')).toBe(true);
    expect(docsEnabled('production')).toBe(false);
    expect(docsEnabled('production', 'true')).toBe(true);
    expect(docsEnabled('development', 'false')).toBe(false);
  });

  it('does not require Google variables outside production', () => {
    expect(validateEnv(valid).GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('does not require the email variables outside production', () => {
    expect(validateEnv(valid).EMAIL_API_KEY).toBeUndefined();
    expect(validateEnv(valid).EMAIL_FROM).toBeUndefined();
    expect(() => validateEnv({ ...valid, EMAIL_API_KEY: 'key' })).toThrow(/EMAIL_FROM/);
  });

  it('requires the Google and email variables in production', () => {
    const production: Record<string, string> = {
      ...valid,
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'https://app.example.com/api/v1/auth/google/callback',
      EMAIL_API_KEY: 'key',
      EMAIL_FROM: 'AGI Board <no-reply@example.com>',
    };
    expect(validateEnv(production).GOOGLE_CLIENT_ID).toBe('id');
    for (const key of ['GOOGLE_CLIENT_ID', 'EMAIL_API_KEY', 'EMAIL_FROM']) {
      expect(() => validateEnv({ ...production, [key]: undefined })).toThrow(new RegExp(key));
    }
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
