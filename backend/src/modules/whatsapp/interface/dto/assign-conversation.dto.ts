import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** `PATCH /conversations/:id/assign` request body (Milestone 8, docs/adr/ADR-011-ai-receptionist.md) — the "take over" / "unassign" action. */
export class AssignConversationDto {
  @ApiPropertyOptional({ description: 'null (or omitted) unassigns.' })
  @IsOptional()
  @IsUUID()
  userId?: string | null;
}
