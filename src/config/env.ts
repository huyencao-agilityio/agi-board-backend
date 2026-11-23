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
    // Optional outside production so local dev and tests boot without a Google project; see the refine below.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: the app refuses to start with a bad environment. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
