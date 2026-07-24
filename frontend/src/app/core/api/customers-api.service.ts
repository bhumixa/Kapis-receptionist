import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Customer } from '../../shared/models/customer.model';

export interface CreateCustomerRequest {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  preferredLanguage?: string;
  marketingOptIn?: boolean;
}

export type UpdateCustomerRequest = Partial<Omit<CreateCustomerRequest, 'phoneNumber'>>;

export interface MessageResponse {
  message: string;
}

/**
 * `/customers[/:id]` (API_SPECIFICATION.md Section 9, docs/adr/
 * ADR-009-scheduling-engine.md). The backend uses cursor pagination for
 * this list (Section 2.4.1's standing rule), but this client fetches a
 * single generous-limit page and skips pagination UI — the same "no
 * pagination UI for a small/bounded list" precedent `EmployeesApiService`/
 * `ServicesApiService` already established, appropriate here since the
 * primary consumer is search-driven (`q`), not a browse-everything list.
 */
@Injectable({ providedIn: 'root' })
export class CustomersApiService {
  private readonly api = inject(ApiClient);

  listCustomers(q?: string): Observable<Customer[]> {
    return this.api.get<Customer[]>('/customers', {
      params: q ? { limit: 100, q } : { limit: 100 },
    });
  }

  getCustomer(id: string): Observable<Customer> {
    return this.api.get<Customer>(`/customers/${id}`);
  }

  createCustomer(request: CreateCustomerRequest): Observable<Customer> {
    return this.api.post<Customer>('/customers', request);
  }

  updateCustomer(id: string, request: UpdateCustomerRequest): Observable<Customer> {
    return this.api.patch<Customer>(`/customers/${id}`, request);
  }

  deleteCustomer(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/customers/${id}`);
  }
}
