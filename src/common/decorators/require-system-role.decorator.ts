import { SetMetadata } from '@nestjs/common';
import type { SystemRole } from '../../generated/prisma/enums';

export const SYSTEM_ROLES = 'systemRoles';

/** Admin console routes. System roles never grant access to workspace or board content. */
export const RequireSystemRole = (...roles: SystemRole[]) => SetMetadata(SYSTEM_ROLES, roles);
