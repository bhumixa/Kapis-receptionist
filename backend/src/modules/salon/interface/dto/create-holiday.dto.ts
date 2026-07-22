import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `POST /salon/holidays` request body. */
export class CreateHolidayDto {
  @ApiProperty({ example: '2026-12-25' })
  @IsString()
  @Matches(ISO_DATE_PATTERN, { message: 'date must be in "YYYY-MM-DD" format' })
  date!: string;

  @ApiProperty({ example: 'Christmas Day' })
  @IsString()
  @Length(1, 255)
  reason!: string;
}
