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
import { SalonProfileService } from '../application/salon-profile.service';
import { UpdateSalonProfileDto } from './dto/update-salon-profile.dto';
import { toSalonProfileResponseDto } from './mappers/salon-response.mapper';

/**
 * `GET/PATCH /salon` (docs/SALON_ARCHITECTURE.md) — singular,
 * unparameterized, always the caller's own resolved tenant, same convention
 * as `TenantController`. Reads are `STAFF`-broad (no permission required);
 * writes require `salon:manage` at `MANAGER`+.
 */
@ApiTags('Salon')
@Controller('salon')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class SalonProfileController {
  constructor(
    private readonly salonProfile: SalonProfileService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async getProfile() {
    const tenantId = await this.tenantContext.requireTenantId();
    const profile = await this.salonProfile.getProfile(tenantId);
    return toSalonProfileResponseDto(profile);
  }

  // TenantActiveGuard applies only to this mutating route, not the reads —
  // a suspended tenant must still be able to view its own salon profile
  // (mirrors TenantController.updateProfile's same rationale).
  @Patch()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('salon:manage')
  async updateProfile(
    @Body() dto: UpdateSalonProfileDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const profile = await this.salonProfile.updateProfile(tenantId, actor, dto);
    return toSalonProfileResponseDto(profile);
  }
}
