import { Controller, Get, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../../src/core/context/tenant-context.service';
import { RequirePermission } from '../../../../src/core/decorators/require-permission.decorator';
import { Roles } from '../../../../src/core/decorators/roles.decorator';
import { PermissionGuard } from '../../../../src/core/guards/permission.guard';
import { RolesGuard } from '../../../../src/core/guards/roles.guard';
import { SuperAdminGuard } from '../../../../src/core/guards/super-admin.guard';
import { TenantScopedGuard } from '../../../../src/core/guards/tenant-scoped.guard';
import { JwtAuthGuard } from '../../../../src/modules/auth/interface/guards/jwt-auth.guard';

/**
 * Test-only controller (docs/adr/ADR-005-rbac.md, extended docs/adr/
 * ADR-006) proving the RBAC/tenant-context guard chokepoint over real HTTP.
 * Mounted only by `test-app.factory.ts`'s `createTestApp()` — never
 * imported by `src/app.module.ts`.
 *
 * The former `@CurrentTenant()` param decorator (a synchronous read of
 * `request.user.tenantId`) was removed in Milestone 3: it predates, and is
 * inconsistent with, the impersonation-aware resolution
 * `TenantContextService` now performs — a `SUPER_ADMIN` impersonating a
 * tenant would resolve differently via the guard than via that decorator.
 * This probe now injects `TenantContextService` directly instead, exactly
 * as every real tenant-scoped controller (`TenantController`, etc.) does.
 */
@Controller('internal/rbac-probe')
@UseGuards(JwtAuthGuard)
export class RbacProbeController {
  constructor(private readonly tenantContext: TenantContextService) {}

  @Get('whoami')
  whoami(): { ok: true } {
    return { ok: true };
  }

  @Get('roles/manager-plus')
  @UseGuards(RolesGuard)
  @Roles(RoleName.MANAGER)
  managerPlus(): { ok: true } {
    return { ok: true };
  }

  @Get('roles/owner-only')
  @UseGuards(RolesGuard)
  @Roles(RoleName.OWNER)
  ownerOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('permissions/billing-manage')
  @UseGuards(PermissionGuard)
  @RequirePermission('billing:manage')
  billingManage(): { ok: true } {
    return { ok: true };
  }

  @Get('permissions/staff-invite')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff:invite')
  staffInvite(): { ok: true } {
    return { ok: true };
  }

  @Get('tenant-scoped')
  @UseGuards(TenantScopedGuard)
  async tenantScoped(): Promise<{ tenantId: string | null }> {
    return { tenantId: await this.tenantContext.getTenantId() };
  }

  @Get('super-admin-only')
  @UseGuards(SuperAdminGuard)
  superAdminOnly(): { ok: true } {
    return { ok: true };
  }
}
