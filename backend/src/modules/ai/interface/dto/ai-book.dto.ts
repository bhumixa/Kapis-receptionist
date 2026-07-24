import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { AppointmentServiceLineDto } from '../../../appointments/interface/dto/appointment-service-line.dto';

export type AiToolActorType = 'AI' | 'CUSTOMER';

/** `POST /ai/tools/book` request body (API_SPECIFICATION.md Section 12) — same shape as `POST /appointments`, plus `conversationId`/`actorType`. */
export class AiBookDto {
  @ApiProperty()
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ enum: ['AI', 'CUSTOMER'] })
  @IsIn(['AI', 'CUSTOMER'])
  actorType!: AiToolActorType;
}
