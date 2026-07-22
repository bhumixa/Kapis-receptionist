import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '../auth/auth-state.service';

/**
 * The mirror image of `authGuard` (docs/FRONTEND_ARCHITECTURE.md Section
 * 3.3): keeps an already-authenticated user off `/auth/login`/`/auth/register`
 * (e.g. a stale bookmark), sending them to the dashboard instead.
 */
export const guestOnlyGuard: CanActivateFn = () => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  if (!authState.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/app/dashboard']);
};
