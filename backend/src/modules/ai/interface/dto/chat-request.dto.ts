import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export type ChatChannel = 'whatsapp' | 'dashboard_test';

/**
 * `POST /ai/chat` request body (API_SPECIFICATION.md Section 12).
 * Narrowed from the full spec this milestone: `customerPhoneNumber`-based
 * resolution isn't built — `channel: "whatsapp"` (the internal-service/
 * eval-suite path; real production traffic never hits this endpoint at
 * all, docs/adr/ADR-011-ai-receptionist.md) requires an already-resolved
 * `conversationId`, matching the in-process flow's own precondition.
 * `channel: "dashboard_test"` accepts `conversationId` or neither (a
 * stateless sandbox turn with no real conversation to preview against).
 */
export class ChatRequestDto {
  @ApiProperty({ required: false })
  @ValidateIf(
    (dto: ChatRequestDto) => dto.channel === 'whatsapp' || !!dto.conversationId,
  )
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ example: 'Do you have anything free Saturday for a haircut?' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  message!: string;

  @ApiProperty({ enum: ['whatsapp', 'dashboard_test'] })
  @IsIn(['whatsapp', 'dashboard_test'])
  channel!: ChatChannel;
}
