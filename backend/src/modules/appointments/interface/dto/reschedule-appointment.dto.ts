import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { AppointmentServiceLineDto } from './appointment-service-line.dto';

/**
 * `POST /appointments/:id/reschedule` request body (API_SPECIFICATION.md
 * Section 10, amended per docs/adr/ADR-009-scheduling-engine.md). `services`
 * is optional — omit to keep the same service/employee assignments, shifted
 * to the new start time; provide it to also reassign employees per line.
 */
export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-08-05T10:00:00Z' })
  @IsISO8601()
  newStartTime!: string;

  @ApiPropertyOptional({ type: [AppointmentServiceLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceLineDto)
  services?: AppointmentServiceLineDto[];
}
