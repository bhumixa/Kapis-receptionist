import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Tenant } from '../../shared/models/tenant.model';
import { Plan, TenantBillingSummary } from '../../shared/models/billing.model';

export type UpdatePlanRequest = Partial<Omit<Plan, 'id' | 'isActive'> & { isActive: boolean }>;

/**
 * `GET /admin/tenants`, `POST /admin/tenants/:id/{suspend,reactivate}`
 * (docs/API_SPECIFICATION.md Section 16, docs/adr/ADR-006's narrow Milestone
 * 3 Admin slice), plus Milestone 9's billing oversight (`GET/PATCH
 * /admin/plans[/:id]`, `GET /admin/tenants/:id/billing`) — `SUPER_ADMIN`
 * only; the backend rejects every other caller regardless of what this
 * service sends.
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly api = inject(ApiClient);

  listTenants(): Observable<Tenant[]> {
    // Single-page fetch, no client-side pagination UI yet — the tenant
    // count this milestone operates at doesn't need it (API_SPECIFICATION.md
    // Section 2.4.2 already treats this as a small, bounded admin list).
    return this.api.get<Tenant[]>('/admin/tenants', { params: { limit: 100 } });
  }

  suspendTenant(tenantId: string, reason?: string): Observable<Tenant> {
    return this.api.post<Tenant>(`/admin/tenants/${tenantId}/suspend`, {
      reason,
    });
  }

  reactivateTenant(tenantId: string): Observable<Tenant> {
    return this.api.post<Tenant>(`/admin/tenants/${tenantId}/reactivate`, {});
  }

  listPlans(): Observable<Plan[]> {
    return this.api.get<Plan[]>('/admin/plans');
  }

  updatePlan(planId: string, request: UpdatePlanRequest): Observable<Plan> {
    return this.api.patch<Plan>(`/admin/plans/${planId}`, request);
  }

  getTenantBilling(tenantId: string): Observable<TenantBillingSummary> {
    return this.api.get<TenantBillingSummary>(`/admin/tenants/${tenantId}/billing`);
  }
}
