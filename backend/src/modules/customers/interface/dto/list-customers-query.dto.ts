import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const SORTABLE_FIELDS = ['firstName', 'createdAt'] as const;

/** `GET /customers` query parameters (API_SPECIFICATION.md Section 9 — cursor pagination). */
export class ListCustomersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  marketingOptIn?: boolean;

  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match against firstName/lastName/phoneNumber.',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: ['-createdAt', 'createdAt', 'firstName', '-firstName'],
    default: '-createdAt',
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

export function parseSort(sort: string | undefined): {
  sortField: (typeof SORTABLE_FIELDS)[number];
  sortDirection: 'asc' | 'desc';
} {
  if (!sort) {
    return { sortField: 'createdAt', sortDirection: 'desc' };
  }
  const direction: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  const sortField = (SORTABLE_FIELDS as readonly string[]).includes(field)
    ? (field as (typeof SORTABLE_FIELDS)[number])
    : 'createdAt';
  return { sortField, sortDirection: direction };
}
