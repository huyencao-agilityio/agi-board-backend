import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://agi:agi@localhost:5432/agi_board',
    APP_ORIGIN: 'http://localhost:5173',
  };

  it('applies defaults', () => {
    expect(validateEnv(valid)).toMatchObject({ NODE_ENV: 'development', PORT: 3000, SESSION_COOKIE_NAME: 'agi_sid' });
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ APP_ORIGIN: valid.APP_ORIGIN })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://x@localhost/db' })).toThrow(/DATABASE_URL/);
  });
});
