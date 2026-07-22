import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `POST /employees/:id/time-off` request body. */
export class CreateTimeOffDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsString()
  @Matches(ISO_DATE_PATTERN, {
    message: 'startDate must be in "YYYY-MM-DD" format',
  })
  startDate!: string;

  @ApiProperty({ example: '2026-08-07' })
  @IsString()
  @Matches(ISO_DATE_PATTERN, {
    message: 'endDate must be in "YYYY-MM-DD" format',
  })
  endDate!: string;

  @ApiPropertyOptional({ example: 'Annual leave' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  reason?: string;
}
