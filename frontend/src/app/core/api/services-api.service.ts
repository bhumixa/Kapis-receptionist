import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Service } from '../../shared/models/service.model';
import { ServiceCategory } from '../../shared/models/service-category.model';

export interface CreateServiceCategoryRequest {
  name: string;
  displayOrder?: number;
}

export type UpdateServiceCategoryRequest = Partial<CreateServiceCategoryRequest>;

export interface CreateServiceRequest {
  categoryId?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  currency?: string;
  bufferTimeMinutes?: number;
  isActive?: boolean;
  displayOrder?: number;
}

export type UpdateServiceRequest = Partial<Omit<CreateServiceRequest, 'categoryId'>> & {
  categoryId?: string | null;
};

export interface MessageResponse {
  message: string;
}

/**
 * `/service-categories[/:id]`, `/services[/:id]` (docs/SERVICE_ARCHITECTURE.md).
 * Thin HTTP wrapper only, no state — mirrors `SalonApiService`'s pattern.
 * Fetches a single generous-limit page for lists (no pagination UI yet) —
 * same precedent as `AdminApiService.listTenants`, appropriate for a
 * per-tenant catalog that's realistically dozens of rows.
 */
@Injectable({ providedIn: 'root' })
export class ServicesApiService {
  private readonly api = inject(ApiClient);

  listCategories(): Observable<ServiceCategory[]> {
    return this.api.get<ServiceCategory[]>('/service-categories');
  }

  createCategory(request: CreateServiceCategoryRequest): Observable<ServiceCategory> {
    return this.api.post<ServiceCategory>('/service-categories', request);
  }

  updateCategory(id: string, request: UpdateServiceCategoryRequest): Observable<ServiceCategory> {
    return this.api.patch<ServiceCategory>(`/service-categories/${id}`, request);
  }

  deleteCategory(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/service-categories/${id}`);
  }

  listServices(): Observable<Service[]> {
    return this.api.get<Service[]>('/services', { params: { limit: 100 } });
  }

  getService(id: string): Observable<Service> {
    return this.api.get<Service>(`/services/${id}`);
  }

  createService(request: CreateServiceRequest): Observable<Service> {
    return this.api.post<Service>('/services', request);
  }

  updateService(id: string, request: UpdateServiceRequest): Observable<Service> {
    return this.api.patch<Service>(`/services/${id}`, request);
  }

  deleteService(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/services/${id}`);
  }
}
