import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { InvalidTenantContextException } from './rbac.exceptions';

/**
 * Baseline "resolvable tenant context" check (docs/adr/ADR-005-rbac.md).
 * `SUPER_ADMIN` passes unconditionally (it has no fixed tenant by design —
 * `AccessTokenPayload.tenantId` is `null`); every other role must carry a
 * `tenantId` to pass at all.
 *
 * Deliberately narrow MVP scope: this does **not** yet check that a
 * specific tenant-owned resource (looked up by `:id`) actually belongs to
 * the caller's tenant — no tenant-owned business resource (Employee,
 * Customer, etc.) exists yet to check against. That per-resource-ID
 * ownership check (return `404 NOT_FOUND`, never `403`, on a cross-tenant
 * mismatch, per API_SPECIFICATION.md Section 2.3.1's anti-enumeration
 * rule — applied uniformly to `SUPER_ADMIN` too, unlike the role/permission
 * bypass in `RolesGuard`/`PermissionGuard`) is an intentionally unbuilt
 * extension point for whichever future module first needs it. See
 * `rbac.exceptions.ts`'s `TenantResourceNotFoundException`, reserved for
 * that use.
 */
@Injectable()
export class TenantScopedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { roles, tenantId } = request.user;

    if (roles.includes(RoleName.SUPER_ADMIN)) {
      return true;
    }

    if (!tenantId) {
      throw new InvalidTenantContextException();
    }

    return true;
  }
}
