import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `PATCH /salon/holidays/:id` request body — at least one field required (enforced in `HolidayService`). */
export class UpdateHolidayDto {
  @ApiPropertyOptional({ example: '2026-12-25' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN, { message: 'date must be in "YYYY-MM-DD" format' })
  date?: string;

  @ApiPropertyOptional({ example: 'Christmas Day' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  reason?: string;
}
