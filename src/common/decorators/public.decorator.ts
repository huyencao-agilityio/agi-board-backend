import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Skips SessionGuard. CSRF is still checked on writes. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
