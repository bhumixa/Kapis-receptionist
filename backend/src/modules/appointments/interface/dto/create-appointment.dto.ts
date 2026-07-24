import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { AppointmentServiceLineDto } from './appointment-service-line.dto';

/**
 * `POST /appointments` request body (API_SPECIFICATION.md Section 10,
 * amended per docs/adr/ADR-009-scheduling-engine.md for per-service
 * employee assignment: `services[]` carries its own `employeeId` per line
 * instead of a single top-level `employeeId` + bare `serviceIds[]`).
 */
export class CreateAppointmentDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: '2026-08-03T14:00:00Z' })
  @IsISO8601()
  startTime!: string;

  @ApiProperty({ type: [AppointmentServiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceLineDto)
  services!: AppointmentServiceLineDto[];

  @ApiPropertyOptional({ example: 'Customer prefers quiet chair.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
