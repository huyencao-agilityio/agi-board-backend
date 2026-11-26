import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The new-password rules need the account's email, so the service checks them (as reset-password does). */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128) // no stored password is longer; spares a PBKDF2 run on a huge string
  currentPassword!: string;

  @ApiProperty({ description: 'Same rules as sign-up: 8–128 characters, a letter, a number, not the email name.' })
  @IsString()
  @IsNotEmpty()
  newPassword!: string;
}
