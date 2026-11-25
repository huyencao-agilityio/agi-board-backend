import { IsString } from 'class-validator';

export class CheckResetLinkDto {
  // No maximum: every malformed link gets the same link error (decision #46); the request body limit bounds it.
  @IsString()
  token!: string;
}
