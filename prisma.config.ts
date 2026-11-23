import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  // Migrations are plain SQL files applied by wrangler (`wrangler d1 migrations apply`), not by Prisma Migrate.
  // DATABASE_URL is only set by scripts/db-diff.sh, to a throwaway local D1 file, for `prisma migrate diff`.
  datasource: { url: process.env.DATABASE_URL },
});
