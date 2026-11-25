import { createHash } from 'node:crypto';
import type { AuthThrottleScope } from '../../generated/prisma/enums';

/** Key of an auth_throttles row: a hash of the lower-cased email, so the table never holds the email. */
export const throttleKey = (scope: AuthThrottleScope, email: string) => ({
  scope,
  subjectKey: createHash('sha256').update(email.toLowerCase()).digest('hex'),
});
