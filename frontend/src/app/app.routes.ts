import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { AuthLayout } from './layouts/auth-layout/auth-layout';
import { DashboardLayout } from './layouts/dashboard-layout/dashboard-layout';
import { PublicLayout } from './layouts/public-layout/public-layout';

/**
 * Milestone 1's placeholder `/` route plus this sprint's `/auth/*` and
 * `/app/dashboard` slice of the full route table
 * (docs/FRONTEND_ARCHITECTURE.md Section 3.2) — the remaining `/app/*` and
 * `/admin/*` rows (RoleGuard, TenantActiveGuard, onboarding) are built out
 * feature by feature starting Milestone 3, once RBAC/tenancy exist.
 */
export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/dashboard-home/pages/dashboard-home-page/dashboard-home-page').then(
            (m) => m.DashboardHomePage,
          ),
      },
    ],
  },
  {
    path: 'auth',
    component: AuthLayout,
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'app',
    component: DashboardLayout,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard-home/pages/app-dashboard-page/app-dashboard-page').then(
            (m) => m.AppDashboardPage,
          ),
      },
    ],
  },
];
