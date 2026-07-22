import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthStateService } from '../auth/auth-state.service';

/**
 * Attaches `X-Impersonate-Tenant-Id` when a `SUPER_ADMIN` has chosen a
 * tenant to act as (docs/adr/ADR-006). Purely mechanical — it has no
 * opinion about *whether* the header should have any effect; that
 * authority check lives entirely server-side
 * (`TenantContextService`/`TenantMiddleware`). For a non-`SUPER_ADMIN`
 * session, `AuthStateService.impersonatedTenant()` is always `null` (the
 * Admin console UI that sets it is itself `SUPER_ADMIN`-gated), so this
 * interceptor is a no-op for every other role in practice — the backend's
 * own spoofing-protection (ignoring the header for non-`SUPER_ADMIN`
 * callers) is the actual, authoritative control either way.
 */
export const tenantImpersonationInterceptor: HttpInterceptorFn = (req, next) => {
  const authState = inject(AuthStateService);
  const impersonatedTenant = authState.impersonatedTenant();

  if (!impersonatedTenant) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { 'X-Impersonate-Tenant-Id': impersonatedTenant.id },
    }),
  );
};
