import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** `GET /appointments/availability` query parameters (API_SPECIFICATION.md Section 10). */
export class GetAvailabilityQueryDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({ example: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString(
    { strict: true },
    { message: 'dateFrom must be an ISO date (YYYY-MM-DD)' },
  )
  dateFrom!: string;

  @ApiProperty({ example: '2026-08-07' })
  @IsDateString(
    { strict: true },
    { message: 'dateTo must be an ISO date (YYYY-MM-DD)' },
  )
  dateTo!: string;
}
