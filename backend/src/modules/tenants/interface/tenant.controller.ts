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
import { toTenantResponseDto } from '../../auth/interface/mappers/auth-response.mapper';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { TenantService } from '../application/tenant.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

/**
 * `GET/PATCH /tenant` (API_SPECIFICATION.md Section 6) — singular,
 * unparameterized paths always refer to the caller's own resolved tenant,
 * never a path `:id`. The resolved tenant id itself comes exclusively from
 * `TenantContextService` (docs/adr/ADR-006) — this controller never reads
 * `request.user.tenantId` or any header directly.
 */
@ApiTags('Tenant')
@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async getProfile() {
    const tenantId = await this.tenantContext.requireTenantId();
    const tenant = await this.tenantService.getProfile(tenantId);
    return toTenantResponseDto(tenant);
  }

  // TenantActiveGuard applied only to this mutating route, not the
  // controller as a whole — a suspended tenant must still be able to read
  // its own profile (FRONTEND_ARCHITECTURE.md Section 3.3's billing-page
  // exemption rationale, applied identically here to any read endpoint).
  @Patch()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('tenant:manage')
  async updateProfile(
    @Body() dto: UpdateTenantDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const tenant = await this.tenantService.updateProfile(tenantId, actor, dto);
    return toTenantResponseDto(tenant);
  }
}
