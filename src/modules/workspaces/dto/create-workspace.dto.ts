import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  // DB: workspaces_name_check CHECK (trim(name) <> ''). Max 100 chosen by the PO (specs/6 research D6): the name is
  // copied into the permanent audit log, so it must be bounded.
  @ApiProperty({ example: 'Marketing', description: 'Trimmed; 1–100 characters.', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
