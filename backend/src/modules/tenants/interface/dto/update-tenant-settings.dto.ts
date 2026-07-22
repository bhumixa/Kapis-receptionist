import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

/**
 * `PATCH /tenant/settings` request body — one optional object per namespace
 * (docs/TENANT_ARCHITECTURE.md). Each provided namespace is shallow-merged
 * into the existing stored object for that namespace (see
 * `PrismaTenantSettingsRepository.updateCategories`); omitted namespaces are
 * left untouched entirely.
 */
export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  general?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  localization?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  business?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  notifications?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  security?: Record<string, unknown>;
}
