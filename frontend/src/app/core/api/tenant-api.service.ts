import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Invitation } from '../../shared/models/invitation.model';
import { Tenant } from '../../shared/models/tenant.model';
import { TenantSettings } from '../../shared/models/tenant-settings.model';
import { RoleName } from '../../shared/models/user.model';

export interface UpdateTenantRequest {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  countryCode?: string;
  timezone?: string;
  defaultLocale?: string;
}

export type UpdateTenantSettingsRequest = Partial<Omit<TenantSettings, 'updatedAt'>>;

export interface CreateInvitationRequest {
  email: string;
  role: Extract<RoleName, 'MANAGER' | 'STAFF'>;
}

export interface MessageResponse {
  message: string;
}

/**
 * `GET/PATCH /tenant`, `GET/PATCH /tenant/settings`, `/tenant/invitations/*`
 * (docs/API_SPECIFICATION.md Section 6, docs/adr/ADR-006 — invitations kept
 * under `/tenant/invitations` rather than `/users`). Thin HTTP wrapper only,
 * no state (FRONTEND_ARCHITECTURE.md Section 10.2).
 */
@Injectable({ providedIn: 'root' })
export class TenantApiService {
  private readonly api = inject(ApiClient);

  getTenant(): Observable<Tenant> {
    return this.api.get<Tenant>('/tenant');
  }

  updateTenant(request: UpdateTenantRequest): Observable<Tenant> {
    return this.api.patch<Tenant>('/tenant', request);
  }

  getSettings(): Observable<TenantSettings> {
    return this.api.get<TenantSettings>('/tenant/settings');
  }

  updateSettings(request: UpdateTenantSettingsRequest): Observable<TenantSettings> {
    return this.api.patch<TenantSettings>('/tenant/settings', request);
  }

  listInvitations(): Observable<Invitation[]> {
    return this.api.get<Invitation[]>('/tenant/invitations');
  }

  createInvitation(request: CreateInvitationRequest): Observable<Invitation & MessageResponse> {
    return this.api.post<Invitation & MessageResponse>('/tenant/invitations', request);
  }

  revokeInvitation(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/tenant/invitations/${id}`);
  }
}
