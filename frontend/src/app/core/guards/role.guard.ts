import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { RoleName } from '../../shared/models/user.model';
import { satisfiesRoleRequirement } from '../../shared/utils/role-rank.util';
import { AuthStateService } from '../auth/auth-state.service';

/**
 * Route-level role check (docs/adr/ADR-005-rbac.md), UX convenience only —
 * the backend's `RolesGuard` is the real security boundary regardless of
 * this guard's outcome. Reads `route.data['roles']` (a single minimum
 * role, satisfied by that role or anything ranked higher — see
 * `role-rank.util.ts`), never makes its own API call
 * (docs/FRONTEND_ARCHITECTURE.md Section 5.8's guard convention).
 *
 * Redirects to `/403` (not `/404`, and not `/auth/login`) on a role
 * mismatch — a role mismatch isn't route-secrecy, and this guard is
 * expected to compose *after* `authGuard`, so an unauthenticated caller
 * should already have been redirected to login before reaching here.
 */
export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  const requiredRoles = route.data['roles'] as RoleName[] | undefined;
  if (!requiredRoles || requiredRoles.length === 0) {
    return true;
  }

  const user = authState.currentUser();
  if (user && satisfiesRoleRequirement(user.roles, requiredRoles)) {
    return true;
  }

  return router.createUrlTree(['/403']);
};
