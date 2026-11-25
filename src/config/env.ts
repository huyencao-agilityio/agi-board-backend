import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ORIGIN: z.url(),
    SESSION_COOKIE_NAME: z.string().min(1).default('agi_sid'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Days without activity before a session expires. */
    SESSION_IDLE_DAYS: z.coerce.number().int().positive().max(30).default(7),
    /**
     * PBKDF2-SHA256 iterations. 10 000 is a compromise for the Workers free plan (~10 ms CPU per request); OWASP
     * recommends 600 000. Raise it after moving to a paid plan. Measure on staging before changing.
     */
    PASSWORD_PBKDF2_ITERATIONS: z.coerce.number().int().min(1000).default(10_000),
    /** Serves Swagger UI. Defaults to on outside production; staging sets it to 'true'. */
    ENABLE_DOCS: z.enum(['true', 'false']).optional(),
    // Optional outside production so local dev and tests boot without a Google project; see the refine below.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: z.url().optional(),
    /** Resend API key. Without it (never in production) emails go to the local Mailpit. */
    EMAIL_API_KEY: z.string().min(1).optional(),
    /** Sender, e.g. `AGI Board <no-reply@example.com>`. */
    EMAIL_FROM: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_API_KEY && !env.EMAIL_FROM && env.NODE_ENV !== 'production') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM'], message: 'EMAIL_FROM is required with EMAIL_API_KEY' });
    }
    if (env.NODE_ENV !== 'production') return;
    for (const key of [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'EMAIL_API_KEY',
      'EMAIL_FROM',
    ] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  });

/** Swagger is on outside production unless ENABLE_DOCS says otherwise. */
export function docsEnabled(nodeEnv: Env['NODE_ENV'], enableDocs?: Env['ENABLE_DOCS']): boolean {
  return enableDocs ? enableDocs === 'true' : nodeEnv !== 'production';
}

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: the app refuses to start with a bad environment. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
