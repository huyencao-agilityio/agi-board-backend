import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BoardVisibility } from '../../../generated/prisma/enums';

export class CreateBoardDto {
  // DB: boards_name_check CHECK (trim(name) <> ''). 512 is an abuse bound, not a product limit (specs/23 research R4):
  // GET /home returns every visible board name unpaginated, so ~100 KB names could exhaust Worker memory.
  @ApiProperty({ example: 'Roadmap', description: 'Trimmed; 1–512 characters.', maxLength: 512 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  name!: string;

  @ApiPropertyOptional({ enum: BoardVisibility, default: BoardVisibility.workspace })
  @IsOptional()
  @IsEnum(BoardVisibility)
  visibility?: BoardVisibility;
}
