import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Tenant } from '../../shared/models/tenant.model';

/**
 * `GET /admin/tenants`, `POST /admin/tenants/:id/{suspend,reactivate}`
 * (docs/API_SPECIFICATION.md Section 16, docs/adr/ADR-006's narrow Milestone
 * 3 Admin slice) — `SUPER_ADMIN` only; the backend rejects every other
 * caller regardless of what this service sends.
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
}
