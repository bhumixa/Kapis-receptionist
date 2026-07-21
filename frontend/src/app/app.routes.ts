import { Routes } from '@angular/router';
import { PublicLayout } from './layouts/public-layout/public-layout';

/**
 * Milestone 1: a single placeholder route proving the layout/routing
 * mechanism. The full route table (docs/FRONTEND_ARCHITECTURE.md Section
 * 3.2) — auth, onboarding, dashboard, admin — is built out feature by
 * feature in later milestones.
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
];
