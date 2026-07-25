import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '../auth/auth-state.service';

const BLOCKING_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/**
 * Frontend counterpart to the backend's `TenantActiveGuard`. Milestone 9
 * (docs/BILLING_ARCHITECTURE.md): now redirects to `/app/billing` —
 * FRONTEND_ARCHITECTURE.md Section 3.3's originally-intended exemption
 * target, reachable precisely because that route is never itself gated by
 * this guard (see `app.routes.ts`), so a blocked tenant can always reach
 * the one screen that resolves the block. `PAST_DUE` deliberately does
 * *not* block (grace-period policy, mirrors the backend's own
 * `TenantActiveGuard` — only `SUSPENDED`/`CANCELLED` are blocking).
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

  return router.createUrlTree(['/app/billing']);
};
