import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // process.env, not env(): `prisma generate` must work without a database (Docker build, CI install).
    url: process.env.DATABASE_URL,
    // Only `prisma migrate dev` needs it; CI and deploy run `migrate deploy`.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
