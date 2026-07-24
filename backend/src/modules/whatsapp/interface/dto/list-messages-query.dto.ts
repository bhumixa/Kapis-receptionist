import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * `GET /messages` query parameters (API_SPECIFICATION.md Section 11) —
 * `conversationId` is required (never a tenant-wide firehose); ascending
 * `createdAt` by default (the one list endpoint whose natural reading order
 * is oldest-first, since it renders a chat thread).
 */
export class ListMessagesQueryDto {
  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from a prior response.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}
