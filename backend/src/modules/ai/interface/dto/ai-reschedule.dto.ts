import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { AppointmentServiceLineDto } from '../../../appointments/interface/dto/appointment-service-line.dto';
import type { AiToolActorType } from './ai-book.dto';

/** `POST /ai/tools/reschedule` request body (API_SPECIFICATION.md Section 12). */
export class AiRescheduleDto {
  @ApiProperty()
  @IsUUID()
  appointmentId!: string;

  @ApiProperty({ example: '2026-08-04T10:00:00Z' })
  @IsISO8601()
  newStartTime!: string;

  @ApiPropertyOptional({
    type: [AppointmentServiceLineDto],
    description: 'Omit to keep the existing service/staff assignment.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceLineDto)
  services?: AppointmentServiceLineDto[];

  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ enum: ['AI', 'CUSTOMER'] })
  @IsIn(['AI', 'CUSTOMER'])
  actorType!: AiToolActorType;
}
