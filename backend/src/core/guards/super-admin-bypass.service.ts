import { ExecutionContext, Injectable } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { SecurityEventService } from '../../modules/auth/application/security-event.service';
import { AccessTokenPayload } from '../../modules/auth/application/token.service';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';

export interface RbacRequirement {
  type: 'role' | 'permission';
  requiredRoles?: RoleName[];
  requiredPermission?: string;
}

/**
 * The single, shared SUPER_ADMIN bypass chokepoint for `RolesGuard` and
 * `PermissionGuard` (docs/adr/ADR-005-rbac.md — a deliberate, reasoned
 * deviation from SYSTEM_ARCHITECTURE.md Section 8.4's original "no implicit
 * tenant-scoped power for Super Admin" design). Kept as one small, fully
 * tested class rather than duplicated inline in each guard, so there is
 * exactly one place that grants the bypass and exactly one place that logs
 * it — never a risk of one guard bypassing silently while another logs.
 *
 * `TenantScopedGuard`'s per-resource ownership checks are NOT bypassed by
 * this service — only role/permission *requirement* checks are. See
 * `tenant-scoped.guard.ts`.
 */
@Injectable()
export class SuperAdminBypassService {
  constructor(private readonly securityEvents: SecurityEventService) {}

  checkAndLog(
    user: AccessTokenPayload,
    context: ExecutionContext,
    requirement: RbacRequirement,
  ): boolean {
    if (!user.roles.includes(RoleName.SUPER_ADMIN)) {
      return false;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.securityEvents.record('SUPER_ADMIN_BYPASS', {
      userId: user.sub,
      tenantId: user.tenantId,
      route: `${request.method} ${request.originalUrl}`,
      ...requirement,
    });
    return true;
  }
}
