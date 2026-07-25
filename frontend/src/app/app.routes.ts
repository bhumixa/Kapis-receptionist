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
 * (docs/adr/ADR-006) with `/app/settings` and the `/admin/*` section
 * (`AdminLayout`, `SUPER_ADMIN`-gated), and in Milestone 9 (docs/BILLING_
 * ARCHITECTURE.md) with `/app/billing` (`tenantActiveGuard`'s redirect
 * target, superseding the interim `/app/tenant-suspended` page) and
 * `/admin/plans` + `/admin/tenants/:id/billing`.
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
        // No tenantActiveGuard here: salon reads are STAFF-broad and stay
        // reachable for a suspended tenant, mirroring the backend's
        // GET-vs-PATCH split (docs/SALON_ARCHITECTURE.md) — mutation
        // buttons are gated in-page via PermissionService instead, with
        // the server-side TenantActiveGuard as the real enforcement.
        path: 'salon',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/salon/pages/salon-profile-page/salon-profile-page').then(
            (m) => m.SalonProfilePage,
          ),
      },
      {
        path: 'salon/business-hours',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/salon/pages/business-hours-page/business-hours-page').then(
            (m) => m.BusinessHoursPage,
          ),
      },
      {
        path: 'salon/holidays',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/salon/pages/holidays-page/holidays-page').then((m) => m.HolidaysPage),
      },
      {
        // No tenantActiveGuard here: employee/service reads are STAFF-broad
        // and stay reachable for a suspended tenant, mirroring `/app/salon`'s
        // same read/write split — mutations are gated in-page via
        // PermissionService, with the server-side TenantActiveGuard as the
        // real enforcement (docs/adr/ADR-008-workforce-and-service-catalog.md).
        path: 'employees',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/employees/pages/employees-list-page/employees-list-page').then(
            (m) => m.EmployeesListPage,
          ),
      },
      {
        path: 'employees/:id',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/employees/pages/employee-profile-page/employee-profile-page').then(
            (m) => m.EmployeeProfilePage,
          ),
      },
      {
        path: 'services',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/services/pages/services-list-page/services-list-page').then(
            (m) => m.ServicesListPage,
          ),
      },
      {
        path: 'services/categories',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/services/pages/service-categories-page/service-categories-page').then(
            (m) => m.ServiceCategoriesPage,
          ),
      },
      {
        // Milestone 6 (docs/adr/ADR-009-scheduling-engine.md). No
        // tenantActiveGuard on reads/the calendar itself — mutations
        // (create/cancel/reschedule) are gated server-side by
        // TenantActiveGuard regardless, mirroring the salon/employees/
        // services read-vs-write split.
        path: 'customers',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/customers/pages/customers-list-page/customers-list-page').then(
            (m) => m.CustomersListPage,
          ),
      },
      {
        path: 'appointments',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/appointments/pages/appointments-calendar-page/appointments-calendar-page').then(
            (m) => m.AppointmentsCalendarPage,
          ),
      },
      {
        // Registered before 'appointments/:id' so 'new' is never matched as an :id.
        path: 'appointments/new',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/appointments/pages/appointment-form-page/appointment-form-page').then(
            (m) => m.AppointmentFormPage,
          ),
      },
      {
        path: 'appointments/:id',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/appointments/pages/appointment-detail-page/appointment-detail-page').then(
            (m) => m.AppointmentDetailPage,
          ),
      },
      {
        // Milestone 7 (docs/WHATSAPP_ARCHITECTURE.md). No tenantActiveGuard
        // on reads/replies — `POST /messages/send` is gated server-side by
        // `TenantActiveGuard` regardless, mirroring the appointments/
        // customers read-vs-write split. Two route entries (list-only and
        // list+selected-detail) both load the same two-pane inbox
        // component, matching `EmployeeProfilePage`'s "list + detail on one
        // page" shape rather than separate routed pages.
        path: 'conversations',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/conversations/pages/conversations-inbox-page/conversations-inbox-page').then(
            (m) => m.ConversationsInboxPage,
          ),
      },
      {
        path: 'conversations/:id',
        canActivate: [roleGuard],
        data: { roles: ['STAFF'] },
        loadComponent: () =>
          import('./features/conversations/pages/conversations-inbox-page/conversations-inbox-page').then(
            (m) => m.ConversationsInboxPage,
          ),
      },
      {
        // Milestone 9 (docs/BILLING_ARCHITECTURE.md): `tenantActiveGuard`'s
        // own redirect target (FRONTEND_ARCHITECTURE.md Section 3.3's
        // exemption pattern) — deliberately not itself gated by
        // `tenantActiveGuard`, or a `SUSPENDED`/`CANCELLED` tenant could
        // never reach the one screen that resolves the block. Readable by
        // `MANAGER`+ (mutations are further gated in-page by
        // `PermissionService.can('billing:manage')`, OWNER-only, mirroring
        // the salon/employees/services read-vs-write split).
        path: 'billing',
        canActivate: [roleGuard],
        data: { roles: ['MANAGER'] },
        loadComponent: () =>
          import('./features/billing/pages/billing-page/billing-page').then((m) => m.BillingPage),
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
      {
        // Milestone 9: Platform Admin subscription lookup + tenant billing
        // status, linked from the "Billing" action on each tenant row.
        path: 'tenants/:id/billing',
        loadComponent: () =>
          import('./features/admin/pages/admin-tenant-billing-page/admin-tenant-billing-page').then(
            (m) => m.AdminTenantBillingPage,
          ),
      },
      {
        path: 'plans',
        loadComponent: () =>
          import('./features/admin/pages/admin-plans-page/admin-plans-page').then(
            (m) => m.AdminPlansPage,
          ),
      },
      { path: '', redirectTo: 'tenants', pathMatch: 'full' },
    ],
  },
];
