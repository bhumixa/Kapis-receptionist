import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

/**
 * `GET /appointments` query parameters (API_SPECIFICATION.md Section 10 —
 * cursor pagination, `sort=startTime` only). Uses flat query param names
 * (`status`, `employeeId`, `customerId`, `startTimeFrom`, `startTimeTo`)
 * rather than the doc's generic `filter[field][op]` bracket notation — the
 * same simplification `ListServicesQueryDto`/`ListEmployeesQueryDto`
 * already made (plain `isActive`/`categoryId` params, no bracket syntax) —
 * bracket-notation query strings parse into nested objects under Express's
 * default `qs` parser, not literal `filter[x][y]`-named keys, so a
 * class-validator DTO expressing them 1:1 would need a nested-object shape
 * rather than flat property names; flat names are simpler and sufficient
 * for this endpoint's actual filter set.
 */
export class ListAppointmentsQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated status list, e.g. CONFIRMED,PENDING',
    enum: AppointmentStatus,
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  startTimeFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-07T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  startTimeTo?: string;

  @ApiPropertyOptional({
    enum: ['startTime', '-startTime'],
    default: 'startTime',
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

export function parseAppointmentSort(sort: string | undefined): 'asc' | 'desc' {
  return sort === '-startTime' ? 'desc' : 'asc';
}
