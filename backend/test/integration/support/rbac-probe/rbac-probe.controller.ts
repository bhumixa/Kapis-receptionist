import { Controller, Get, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { CurrentTenant } from '../../../../src/core/decorators/current-tenant.decorator';
import { RequirePermission } from '../../../../src/core/decorators/require-permission.decorator';
import { Roles } from '../../../../src/core/decorators/roles.decorator';
import { PermissionGuard } from '../../../../src/core/guards/permission.guard';
import { RolesGuard } from '../../../../src/core/guards/roles.guard';
import { SuperAdminGuard } from '../../../../src/core/guards/super-admin.guard';
import { TenantScopedGuard } from '../../../../src/core/guards/tenant-scoped.guard';
import { JwtAuthGuard } from '../../../../src/modules/auth/interface/guards/jwt-auth.guard';

/**
 * Test-only controller (docs/adr/ADR-005-rbac.md) proving the RBAC guard
 * chokepoint over real HTTP. Mounted only by `test-app.factory.ts`'s
 * `createTestApp()` — never imported by `src/app.module.ts` — since no
 * production business controller exists yet to attach `@Roles`/
 * `@RequirePermission` to (Users/Tenants CRUD is out of this sprint's scope).
 */
@Controller('internal/rbac-probe')
@UseGuards(JwtAuthGuard)
export class RbacProbeController {
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
  tenantScoped(@CurrentTenant() tenantId: string | null): {
    tenantId: string | null;
  } {
    return { tenantId };
  }

  @Get('super-admin-only')
  @UseGuards(SuperAdminGuard)
  superAdminOnly(): { ok: true } {
    return { ok: true };
  }
}
