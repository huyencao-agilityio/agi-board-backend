import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { MemberRole } from '../../../generated/prisma/enums';

export class CreateInviteDto {
  // DB: invites_email_check CHECK (email = lower(trim(email))).
  @ApiProperty({ example: 'new.person@example.com', description: 'Trimmed and lower-cased.', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ enum: MemberRole, default: MemberRole.member })
  @IsOptional()
  @IsEnum(MemberRole)
  role?: MemberRole;
}
