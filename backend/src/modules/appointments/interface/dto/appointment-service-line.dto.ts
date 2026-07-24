import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** One `{ serviceId, employeeId }` line — per-service employee assignment (docs/adr/ADR-009-scheduling-engine.md). */
export class AppointmentServiceLineDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  employeeId!: string;
}
