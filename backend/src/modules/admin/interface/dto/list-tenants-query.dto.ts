import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TenantStatus } from '@prisma/client';

/**
 * `GET /admin/tenants` query parameters — a simplified subset of
 * API_SPECIFICATION.md Section 2.5's general bracket-notation filter
 * convention (`filter[status]=...`), since no other endpoint in this
 * codebase has implemented that generic convention yet. Documented as a
 * deliberate simplification in docs/TENANT_ARCHITECTURE.md, not a silent
 * deviation.
 */
export class ListTenantsQueryDto {
  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match against name/slug.',
  })
  @IsOptional()
  @IsString()
  q?: string;

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
