import { Routes } from '@angular/router';
import { guestOnlyGuard } from '../../core/guards/guest-only.guard';

/** docs/FRONTEND_ARCHITECTURE.md Section 3.2 `/auth/*` rows this sprint implements. */
export const authRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestOnlyGuard],
    loadComponent: () => import('./pages/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestOnlyGuard],
    loadComponent: () => import('./pages/register-page/register-page').then((m) => m.RegisterPage),
  },
];
