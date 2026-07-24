import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ConversationStatus } from '@prisma/client';

/** `PATCH /conversations/:id` request body. */
export class UpdateConversationStatusDto {
  @ApiProperty({ enum: ConversationStatus })
  @IsEnum(ConversationStatus)
  status!: ConversationStatus;
}
