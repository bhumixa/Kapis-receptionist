import { CanActivate, Injectable } from '@nestjs/common';
import { TenantContextService } from '../context/tenant-context.service';

/**
 * Baseline "resolvable tenant context" check (docs/adr/ADR-005-rbac.md,
 * evolved in docs/adr/ADR-006 to delegate resolution to
 * `TenantContextService` now that it has real consumers). Simply requires
 * `TenantContextService.requireTenantId()` to succeed — which itself
 * encodes every resolution rule (JWT claim vs. impersonation header,
 * Super-Admin-without-impersonation-context rejection, spoofing
 * protection) in one authoritative place, per ADR-006's "resolve tenant
 * context exclusively through TenantMiddleware and TenantContextService"
 * requirement.
 *
 * Note this is a behavior change from the original Sprint 2.4 version: a
 * `SUPER_ADMIN` with no `X-Impersonate-Tenant-Id` header now fails this
 * guard (there is no "my tenant" for a Super Admin acting on a genuinely
 * tenant-scoped resource) rather than passing unconditionally with a
 * `null` tenant. This is the concrete mechanism the original design's
 * "Super Admin has no fixed tenant" placeholder was always going to need
 * once a real tenant-owned resource existed to check against.
 *
 * Still does **not** perform per-resource-ID ownership checks (e.g.
 * "does *this* `:id` belong to the resolved tenant") — that remains an
 * open extension point for whichever module's repository layer needs it
 * (the `TenantScopedRepository` base class, Milestone 3, is where that
 * lives going forward).
 */
@Injectable()
export class TenantScopedGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  async canActivate(): Promise<boolean> {
    await this.tenantContext.requireTenantId();
    return true;
  }
}
