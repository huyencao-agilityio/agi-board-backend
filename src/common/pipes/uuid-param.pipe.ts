import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/** A path-id pipe whose error is a list of messages, so the filter answers VALIDATION_FAILED like the ValidationPipe. */
export const uuidParam = (name: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException([`${name} must be a UUID`]) });
