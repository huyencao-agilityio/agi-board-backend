import { ForbiddenException } from '@nestjs/common';

export const accountDeactivated = () =>
  new ForbiddenException({
    code: 'ACCOUNT_DEACTIVATED',
    message: 'This account has been deactivated. Contact your administrator.',
  });
