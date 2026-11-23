import { execSync } from 'node:child_process';
import { E2E_STATE_DIR } from './state';

/** e2e tests run against their own local D1 (wrangler state in E2E_STATE_DIR), migrated by wrangler. */
export default function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL ??= 'warn';
  process.env.APP_ORIGIN ??= 'http://localhost:5173';
  execSync(`pnpm -s wrangler d1 migrations apply DB --local --persist-to ${E2E_STATE_DIR}`, {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
}
