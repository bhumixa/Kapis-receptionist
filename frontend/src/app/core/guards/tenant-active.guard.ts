import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '../auth/auth-state.service';

const BLOCKING_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/**
 * Frontend counterpart to the backend's `TenantActiveGuard` (Milestone 3
 * structural skeleton — no plan-limit logic, that's Milestone 8). Redirects
 * to `/app/tenant-suspended` instead of FRONTEND_ARCHITECTURE.md's originally
 * envisioned `/app/billing` exemption target, since Billing doesn't exist
 * yet (Milestone 8); update this redirect once it does.
 *
 * Reads `AuthStateService.currentTenant()` only — no API call of its own,
 * same convention as `authGuard`/`roleGuard`. A `SUPER_ADMIN` (no fixed
 * tenant, `currentTenant()` is `null`) is never blocked by this guard.
 */
export const tenantActiveGuard: CanActivateFn = () => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  const tenant = authState.currentTenant();
  if (!tenant || !BLOCKING_STATUSES.has(tenant.status)) {
    return true;
  }

  return router.createUrlTree(['/app/tenant-suspended']);
};
