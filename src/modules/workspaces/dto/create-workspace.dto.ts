import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  // DB: workspaces_name_check CHECK (trim(name) <> ''). Max 100 chosen by the PO (specs/6 research D6): the name is
  // copied into the permanent audit log, so it must be bounded.
  // Line breaks become spaces (WEB-D16 #239) on the server too, so every client stores a single-line audit label.
  @ApiProperty({
    example: 'Marketing',
    description: 'Line breaks become spaces, then trimmed; 1–100 characters.',
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
