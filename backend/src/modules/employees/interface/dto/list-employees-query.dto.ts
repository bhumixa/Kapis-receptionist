import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { EmployeeStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const SORTABLE_FIELDS = ['firstName', 'status'] as const;

/** `GET /employees` query parameters (API_SPECIFICATION.md Section 2.4.2 — offset pagination, small per-tenant staff list). */
export class ListEmployeesQueryDto {
  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({
    description:
      'Only employees eligible for this service (joins EmployeeService).',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match against firstName/lastName.',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: ['firstName', '-firstName', 'status', '-status'],
    default: 'firstName',
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

export function parseEmployeeSort(sort: string | undefined): {
  sortField: (typeof SORTABLE_FIELDS)[number];
  sortDirection: 'asc' | 'desc';
} {
  if (!sort) {
    return { sortField: 'firstName', sortDirection: 'asc' };
  }
  const direction: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  const sortField = (SORTABLE_FIELDS as readonly string[]).includes(field)
    ? (field as (typeof SORTABLE_FIELDS)[number])
    : 'firstName';
  return { sortField, sortDirection: direction };
}
