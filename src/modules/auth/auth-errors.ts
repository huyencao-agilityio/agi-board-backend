import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });

export const accountDeactivated = () =>
  new ForbiddenException({
    code: 'ACCOUNT_DEACTIVATED',
    message: 'This account has been deactivated. Contact your administrator.',
  });
