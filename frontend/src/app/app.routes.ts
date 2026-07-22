import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { tenantActiveGuard } from './core/guards/tenant-active.guard';
import { AdminLayout } from './layouts/admin-layout/admin-layout';
import { AuthLayout } from './layouts/auth-layout/auth-layout';
import { DashboardLayout } from './layouts/dashboard-layout/dashboard-layout';
import { PublicLayout } from './layouts/public-layout/public-layout';

/**
 * Milestone 1's placeholder `/` route, the `/auth/*` slice, and
 * `/app/dashboard` from earlier milestones, extended in Milestone 3
 * (docs/adr/ADR-006) with `/app/settings`, `/app/tenant-suspended`
 * (`tenantActiveGuard`'s redirect target), and the `/admin/*` section
 * (`AdminLayout`, `SUPER_ADMIN`-gated) — the remaining `/app/*` rows
 * (appointments, customers, ...) are built out feature by feature starting
 * Milestone 4/5, once those modules exist.
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
      {
        path: 'settings',
        canActivate: [tenantActiveGuard, roleGuard],
        data: { roles: ['MANAGER'] },
        loadComponent: () =>
          import('./features/settings/pages/settings-page/settings-page').then(
            (m) => m.SettingsPage,
          ),
      },
      {
        // TenantActiveGuard's own redirect target (Section 3.3's exemption
        // pattern) — deliberately not itself gated by tenantActiveGuard, or
        // a suspended tenant could never reach the page explaining why.
        path: 'tenant-suspended',
        loadComponent: () =>
          import('./features/dashboard-home/pages/tenant-suspended-page/tenant-suspended-page').then(
            (m) => m.TenantSuspendedPage,
          ),
      },
    ],
  },
  {
    path: 'admin',
    component: AdminLayout,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['SUPER_ADMIN'] },
    children: [
      {
        path: 'tenants',
        loadComponent: () =>
          import('./features/admin/pages/admin-tenants-page/admin-tenants-page').then(
            (m) => m.AdminTenantsPage,
          ),
      },
      { path: '', redirectTo: 'tenants', pathMatch: 'full' },
    ],
  },
];
