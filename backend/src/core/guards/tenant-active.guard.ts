import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RoleName, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { TenantContextService } from '../context/tenant-context.service';
import { TenantSuspendedException } from './rbac.exceptions';

/**
 * Structural skeleton (IMPLEMENTATION_ROADMAP.md Sprint 3.1) blocking
 * `SUSPENDED`/`CANCELLED` tenants from mutating tenant-scoped endpoints with
 * `402 TENANT_SUSPENDED`. No plan-limit/usage enforcement here — that's
 * Milestone 8's job once `Subscription` exists; this guard only checks
 * `Tenant.status`, which already exists.
 *
 * `SUPER_ADMIN` always bypasses — acting on a suspended tenant (to
 * investigate or fix it) is exactly the kind of support action Super Admin
 * access exists for, not something this guard should block.
 *
 * Apply this only to mutating routes (mirrors `TenantActiveGuard`'s
 * frontend counterpart, FRONTEND_ARCHITECTURE.md Section 3.1) — read
 * endpoints on a suspended tenant remain reachable so the caller can at
 * least see what's blocked and why.
 */
@Injectable()
export class TenantActiveGuard implements CanActivate {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user.roles.includes(RoleName.SUPER_ADMIN)) {
      return true;
    }

    const tenantId = await this.tenantContext.requireTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });

    if (
      tenant &&
      (tenant.status === TenantStatus.SUSPENDED ||
        tenant.status === TenantStatus.CANCELLED)
    ) {
      throw new TenantSuspendedException();
    }

    return true;
  }
}
