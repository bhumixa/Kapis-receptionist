import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const SORTABLE_FIELDS = ['name', 'priceCents', 'displayOrder'] as const;

/** `GET /services` query parameters (API_SPECIFICATION.md Section 2.4.2 — offset pagination, small per-tenant catalog). */
export class ListServicesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match against name/description.',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: [
      'displayOrder',
      '-displayOrder',
      'name',
      '-name',
      'priceCents',
      '-priceCents',
    ],
    default: 'displayOrder',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

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
    return { sortField: 'displayOrder', sortDirection: 'asc' };
  }
  const direction: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  const sortField = (SORTABLE_FIELDS as readonly string[]).includes(field)
    ? (field as (typeof SORTABLE_FIELDS)[number])
    : 'displayOrder';
  return { sortField, sortDirection: direction };
}
