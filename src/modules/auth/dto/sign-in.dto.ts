import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EmailDto } from './email.dto';

export class SignInDto extends EmailDto {
  // No strength rules at sign-in; the cap only bounds the hashing cost.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
