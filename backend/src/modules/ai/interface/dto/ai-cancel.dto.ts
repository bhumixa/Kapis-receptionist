import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type { AiToolActorType } from './ai-book.dto';

/** `POST /ai/tools/cancel` request body (API_SPECIFICATION.md Section 12). */
export class AiCancelDto {
  @ApiProperty()
  @IsUUID()
  appointmentId!: string;

  @ApiPropertyOptional({ example: 'Customer requested via WhatsApp.' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ enum: ['AI', 'CUSTOMER'] })
  @IsIn(['AI', 'CUSTOMER'])
  actorType!: AiToolActorType;
}
