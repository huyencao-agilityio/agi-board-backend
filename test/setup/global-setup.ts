import { execSync } from 'node:child_process';

/** e2e tests run against a separate database, migrated from scratch-safe `migrate deploy`. */
export default function globalSetup() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://agi:agi@localhost:5432/agi_board_test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL ??= 'warn';
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
