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
  {
    path: 'forgot-password',
    canActivate: [guestOnlyGuard],
    loadComponent: () =>
      import('./pages/forgot-password-page/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password/:token',
    canActivate: [guestOnlyGuard],
    loadComponent: () =>
      import('./pages/reset-password-page/reset-password-page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'verify-email/:token',
    // No guard: reachable whether or not the user currently has an active
    // session (FRONTEND_ARCHITECTURE.md Section 5.4) — the link is
    // delivered via email and may be opened on a different device/browser.
    loadComponent: () =>
      import('./pages/verify-email-page/verify-email-page').then((m) => m.VerifyEmailPage),
  },
];
