import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * `PATCH /appointments/:id` request body — deliberately the only mutable
 * field via this endpoint (API_SPECIFICATION.md Section 10). `status`,
 * `startTime`, `employeeId`/`services` are never accepted here; those go
 * through `.../cancel` and `.../reschedule`, which carry the booking-
 * integrity guarantees (conflict checks, history logging) a generic PATCH
 * must not silently bypass.
 */
export class UpdateAppointmentDto {
  @ApiPropertyOptional({ example: 'Updated note.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
