import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantActiveGuard } from '../../../core/guards/tenant-active.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { RequirePermission } from '../../../core/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { TenantSettingsService } from '../application/tenant-settings.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { toTenantSettingsResponseDto } from './mappers/tenant-response.mapper';

/**
 * `GET/PATCH /tenant/settings` (API_SPECIFICATION.md Section 6). `OWNER`/
 * `MANAGER` only for both read and write — unlike `GET /tenant`'s basic
 * profile (broadly readable), AI/booking-policy configuration is not
 * `STAFF`-visible.
 */
@ApiTags('Tenant')
@Controller('tenant/settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
@Roles(RoleName.MANAGER)
export class TenantSettingsController {
  constructor(
    private readonly settingsService: TenantSettingsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  async getSettings() {
    const tenantId = await this.tenantContext.requireTenantId();
    const settings = await this.settingsService.getSettings(tenantId);
    return toTenantSettingsResponseDto(settings);
  }

  @Patch()
  @UseGuards(TenantActiveGuard)
  @RequirePermission('settings:manage')
  async updateSettings(
    @Body() dto: UpdateTenantSettingsDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const settings = await this.settingsService.updateSettings(
      tenantId,
      actor,
      dto,
    );
    return toTenantSettingsResponseDto(settings);
  }
}
