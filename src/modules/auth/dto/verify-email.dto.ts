import { Matches } from 'class-validator';
import { IsNewPassword } from '../password-rules';
import { EmailDto } from './email.dto';

export class VerifyEmailDto extends EmailDto {
  @Matches(/^\d{6}$/)
  code!: string;

  // Becomes the account's password once the code proves who holds the mailbox.
  @IsNewPassword()
  password!: string;
}
