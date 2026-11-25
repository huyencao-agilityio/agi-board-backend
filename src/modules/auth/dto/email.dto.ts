import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/** The `email` field of every public auth body: trimmed and lower-cased. */
export class EmailDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
