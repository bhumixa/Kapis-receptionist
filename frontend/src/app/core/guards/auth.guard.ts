import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '../auth/auth-state.service';

/**
 * Route-level session check only — reads the already-resolved
 * `AuthStateService` signal, never makes its own API call
 * (docs/FRONTEND_ARCHITECTURE.md Section 5.8; session state is guaranteed
 * resolved by the time any guard runs, per Section 5.6's bootstrap
 * sequencing in `app.config.ts`).
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  if (authState.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/auth/login'], {
    queryParams: { returnUrl: state.url },
  });
};
