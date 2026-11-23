import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = { APP_ORIGIN: 'http://localhost:5173' };

  it('applies defaults', () => {
    expect(validateEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      SESSION_COOKIE_NAME: 'agi_sid',
    });
  });

  it('rejects a missing APP_ORIGIN', () => {
    expect(() => validateEnv({})).toThrow(/APP_ORIGIN/);
  });
});
