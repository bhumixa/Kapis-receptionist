import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Invoice, Payment, Plan, Subscription } from '../../shared/models/billing.model';

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string | null;
  subscriptionId: string;
}

/**
 * `/plans`, `/subscriptions[/*]`, `/invoices`, `/payments` (docs/
 * API_SPECIFICATION.md Section 13). Thin HTTP wrapper only, no state,
 * mirrors `TenantApiService`'s pattern. `Idempotency-Key` on `createCheckoutSession`
 * matches `AppointmentsApiService`'s existing precedent (a fresh key per
 * user click, not reused across retries, API_SPECIFICATION.md Section 2.13).
 * List endpoints fetch a single generous page (no pagination UI yet), same
 * convention as `EmployeesApiService.listEmployees`/`AdminApiService.listTenants`.
 */
@Injectable({ providedIn: 'root' })
export class BillingApiService {
  private readonly api = inject(ApiClient);

  listPlans(): Observable<Plan[]> {
    return this.api.get<Plan[]>('/plans');
  }

  getSubscription(): Observable<Subscription> {
    return this.api.get<Subscription>('/subscriptions');
  }

  createCheckoutSession(
    planId: string,
    couponCode?: string,
  ): Observable<CreateCheckoutSessionResponse> {
    return this.api.post<CreateCheckoutSessionResponse>(
      '/subscriptions',
      { planId, couponCode },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    );
  }

  changePlan(planId: string): Observable<Subscription> {
    return this.api.post<Subscription>('/subscriptions/change-plan', { planId });
  }

  cancelSubscription(): Observable<Subscription> {
    return this.api.post<Subscription>('/subscriptions/cancel', {});
  }

  reactivateSubscription(): Observable<Subscription> {
    return this.api.post<Subscription>('/subscriptions/reactivate', {});
  }

  createPortalSession(): Observable<{ url: string }> {
    return this.api.post<{ url: string }>('/subscriptions/portal-session', {});
  }

  listInvoices(): Observable<Invoice[]> {
    return this.api.get<Invoice[]>('/invoices', { params: { pageSize: 50 } });
  }

  listPayments(): Observable<Payment[]> {
    return this.api.get<Payment[]>('/payments', { params: { pageSize: 50 } });
  }
}
