import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApiService } from '../../../../core/api/admin-api.service';
import { Invoice, Subscription } from '../../../../shared/models/billing.model';

/**
 * `/admin/tenants/:id/billing` — Platform Admin subscription lookup +
 * tenant billing status (`GET /admin/tenants/:id/billing`, Milestone 9
 * deliverables "Subscription lookup" and "Tenant billing status"). Linked
 * from the tenant row in `AdminTenantsPage`, matching `EmployeeProfilePage`'s
 * snapshot-based `:id` read (no reactive param changes needed for a
 * detail page reached via a fresh navigation each time).
 */
@Component({
  selector: 'app-admin-tenant-billing-page',
  standalone: true,
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-tenant-billing-page.html',
})
export class AdminTenantBillingPage {
  private readonly route = inject(ActivatedRoute);
  private readonly adminApi = inject(AdminApiService);

  readonly tenantId = this.route.snapshot.paramMap.get('id')!;

  readonly subscription = signal<Subscription | null>(null);
  readonly invoices = signal<Invoice[]>([]);
  readonly invoiceTotal = signal(0);
  readonly isLoading = signal(true);
  readonly notFound = signal(false);

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.adminApi.getTenantBilling(this.tenantId).subscribe({
      next: (summary) => {
        this.subscription.set(summary.subscription);
        this.invoices.set(summary.invoices.items);
        this.invoiceTotal.set(summary.invoices.total);
        this.isLoading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.isLoading.set(false);
      },
    });
  }

  formatCents(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  }
}
