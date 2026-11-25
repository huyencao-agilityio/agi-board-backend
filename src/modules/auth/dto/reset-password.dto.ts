import { IsNewPassword } from '../password/password-rules';
import { CheckResetLinkDto } from './check-reset-link.dto';

export class ResetPasswordDto extends CheckResetLinkDto {
  // The email-name rule runs in the service: the email comes from the link, never from the client.
  @IsNewPassword()
  password!: string;
}
