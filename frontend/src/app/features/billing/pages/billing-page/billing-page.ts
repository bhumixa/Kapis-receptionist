import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BillingApiService } from '../../../../core/api/billing-api.service';
import { EmployeesApiService } from '../../../../core/api/employees-api.service';
import { ApiError } from '../../../../core/api/api-error';
import { PermissionService } from '../../../../core/auth/permission.service';
import { Invoice, Payment, Plan, Subscription } from '../../../../shared/models/billing.model';

/**
 * `/app/billing` (docs/FRONTEND_ARCHITECTURE.md Section 6.8) — deliberately
 * **not** gated by `tenantActiveGuard` (see `app.routes.ts`): a `PAST_DUE`/
 * `SUSPENDED` tenant must still be able to reach this page to fix their
 * billing, since it's the guard's own redirect target. Subscription
 * overview + usage, plan comparison (upgrade/downgrade), invoice/payment
 * history, and the Stripe Customer Portal entry point all live on one page
 * — mirrors `SettingsPage`'s single-page-with-sections shape rather than
 * splitting into separate routed pages.
 */
@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './billing-page.html',
})
export class BillingPage {
  private readonly billingApi = inject(BillingApiService);
  private readonly employeesApi = inject(EmployeesApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageBilling = this.permissionService.can('billing:manage');

  readonly subscription = signal<Subscription | null>(null);
  readonly isLoadingSubscription = signal(true);
  readonly subscriptionError = signal<string | null>(null);

  readonly plans = signal<Plan[]>([]);
  readonly isLoadingPlans = signal(true);
  readonly changingPlanId = signal<string | null>(null);

  readonly invoices = signal<Invoice[]>([]);
  readonly isLoadingInvoices = signal(true);

  readonly payments = signal<Payment[]>([]);
  readonly isLoadingPayments = signal(true);

  readonly staffCount = signal<number | null>(null);

  readonly isRedirecting = signal(false);
  readonly isCanceling = signal(false);
  readonly isReactivating = signal(false);
  readonly actionError = signal<string | null>(null);

  constructor() {
    this.loadSubscription();
    this.loadPlans();
    this.loadInvoices();
    this.loadPayments();
    this.loadStaffCount();
  }

  private loadSubscription(): void {
    this.isLoadingSubscription.set(true);
    this.billingApi.getSubscription().subscribe({
      next: (subscription) => {
        this.subscription.set(subscription);
        this.isLoadingSubscription.set(false);
      },
      error: (error: unknown) => {
        this.isLoadingSubscription.set(false);
        this.subscriptionError.set(
          error instanceof ApiError ? error.message : 'Could not load your subscription.',
        );
      },
    });
  }

  private loadPlans(): void {
    this.isLoadingPlans.set(true);
    this.billingApi.listPlans().subscribe({
      next: (plans) => {
        this.plans.set(plans);
        this.isLoadingPlans.set(false);
      },
      error: () => this.isLoadingPlans.set(false),
    });
  }

  private loadInvoices(): void {
    this.isLoadingInvoices.set(true);
    this.billingApi.listInvoices().subscribe({
      next: (invoices) => {
        this.invoices.set(invoices);
        this.isLoadingInvoices.set(false);
      },
      error: () => this.isLoadingInvoices.set(false),
    });
  }

  private loadPayments(): void {
    this.isLoadingPayments.set(true);
    this.billingApi.listPayments().subscribe({
      next: (payments) => {
        this.payments.set(payments);
        this.isLoadingPayments.set(false);
      },
      error: () => this.isLoadingPayments.set(false),
    });
  }

  private loadStaffCount(): void {
    this.employeesApi.listEmployees().subscribe({
      next: (employees) => this.staffCount.set(employees.length),
      error: () => this.staffCount.set(null),
    });
  }

  selectPlan(plan: Plan): void {
    const current = this.subscription();
    if (!current || this.changingPlanId() || plan.id === current.planId) {
      return;
    }
    this.actionError.set(null);
    this.changingPlanId.set(plan.id);

    if (current.hasStripeSubscription) {
      this.billingApi.changePlan(plan.id).subscribe({
        next: (updated) => {
          this.subscription.set(updated);
          this.changingPlanId.set(null);
        },
        error: (error: unknown) => {
          this.changingPlanId.set(null);
          this.actionError.set(
            error instanceof ApiError ? error.message : 'Could not change plans.',
          );
        },
      });
      return;
    }

    // No live Stripe subscription yet (still trial-only) — start Checkout
    // so the tenant attaches a payment method before this plan takes effect.
    this.billingApi.createCheckoutSession(plan.id).subscribe({
      next: (result) => {
        this.changingPlanId.set(null);
        if (result.checkoutUrl) {
          this.isRedirecting.set(true);
          window.location.href = result.checkoutUrl;
        }
      },
      error: (error: unknown) => {
        this.changingPlanId.set(null);
        this.actionError.set(
          error instanceof ApiError ? error.message : 'Could not start checkout.',
        );
      },
    });
  }

  openCustomerPortal(): void {
    this.actionError.set(null);
    this.isRedirecting.set(true);
    this.billingApi.createPortalSession().subscribe({
      next: (result) => {
        window.location.href = result.url;
      },
      error: (error: unknown) => {
        this.isRedirecting.set(false);
        this.actionError.set(
          error instanceof ApiError ? error.message : 'Could not open the billing portal.',
        );
      },
    });
  }

  cancelSubscription(): void {
    if (
      !confirm(
        'Cancel your subscription? You will keep access until the end of the current billing period.',
      )
    ) {
      return;
    }
    this.actionError.set(null);
    this.isCanceling.set(true);
    this.billingApi.cancelSubscription().subscribe({
      next: (updated) => {
        this.subscription.set(updated);
        this.isCanceling.set(false);
      },
      error: (error: unknown) => {
        this.isCanceling.set(false);
        this.actionError.set(
          error instanceof ApiError ? error.message : 'Could not cancel the subscription.',
        );
      },
    });
  }

  reactivateSubscription(): void {
    this.actionError.set(null);
    this.isReactivating.set(true);
    this.billingApi.reactivateSubscription().subscribe({
      next: (updated) => {
        this.subscription.set(updated);
        this.isReactivating.set(false);
      },
      error: (error: unknown) => {
        this.isReactivating.set(false);
        this.actionError.set(
          error instanceof ApiError ? error.message : 'Could not reactivate the subscription.',
        );
      },
    });
  }

  formatCents(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'ACTIVE':
      case 'PAID':
      case 'SUCCEEDED':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'TRIALING':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'PAST_DUE':
      case 'OPEN':
      case 'PENDING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'CANCELED':
      case 'VOID':
      case 'INCOMPLETE':
        return 'bg-gray-100 text-gray-600 border-gray-200';
      case 'UNPAID':
      case 'FAILED':
      case 'UNCOLLECTIBLE':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  }

  usagePercent(used: number, limit: number | null): number {
    if (limit === null || limit === 0) {
      return 0;
    }
    return Math.min(100, Math.round((used / limit) * 100));
  }
}
