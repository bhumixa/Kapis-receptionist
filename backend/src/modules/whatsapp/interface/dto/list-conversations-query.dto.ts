import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ConversationStatus } from '@prisma/client';

/** `GET /conversations` query parameters (API_SPECIFICATION.md Section 11) — cursor pagination, sorted by `lastMessageAt` descending by default (most recently active first, standard inbox ordering). */
export class ListConversationsQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated status list, e.g. OPEN,RESOLVED',
    enum: ConversationStatus,
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsEnum(ConversationStatus, { each: true })
  status?: ConversationStatus[];

  @ApiPropertyOptional({
    enum: ['lastMessageAt', '-lastMessageAt'],
    default: '-lastMessageAt',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from a prior response.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export function parseConversationSort(
  sort: string | undefined,
): 'asc' | 'desc' {
  return sort === 'lastMessageAt' ? 'asc' : 'desc';
}
