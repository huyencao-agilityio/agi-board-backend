import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SignInDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // No strength rules at sign-in; the cap only bounds the hashing cost.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
