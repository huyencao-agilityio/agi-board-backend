import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsNewPassword } from '../password/password-rules';
import { EmailDto } from './email.dto';

export class SignUpDto extends EmailDto {
  // No maximum by decision #36; the request body limit bounds it.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsNewPassword()
  password!: string;
}
