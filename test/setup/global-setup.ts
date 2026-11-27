import { execSync } from 'node:child_process';
import { E2E_STATE_DIR } from './state';

/** e2e tests run against their own local D1 (wrangler state in E2E_STATE_DIR), migrated by wrangler. */
export default function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL ??= 'warn';
  process.env.APP_ORIGIN ??= 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID ??= 'e2e-client';
  process.env.GOOGLE_CLIENT_SECRET ??= 'e2e-secret';
  process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:8787/api/v1/auth/google/callback';
  execSync(`pnpm -s wrangler d1 migrations apply DB --local --persist-to ${E2E_STATE_DIR}`, {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
  // Catalog rows (label colors, preset backgrounds) that new boards reference; idempotent like on deploy.
  execSync(`pnpm -s wrangler d1 execute DB --local --persist-to ${E2E_STATE_DIR} --file prisma/seed.sql`, {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
}
