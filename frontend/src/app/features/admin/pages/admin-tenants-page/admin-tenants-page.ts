import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AdminApiService } from '../../../../core/api/admin-api.service';
import { AuthStateService } from '../../../../core/auth/auth-state.service';
import { Tenant } from '../../../../shared/models/tenant.model';

/**
 * `/admin/tenants` — the Super Admin console's tenant list, lifecycle
 * actions (suspend/reactivate), and the tenant switcher: "Act as" sets
 * `AuthStateService.impersonatedTenant`, which `tenantImpersonationInterceptor`
 * turns into the `X-Impersonate-Tenant-Id` header every subsequent
 * tenant-scoped request carries (docs/adr/ADR-006). Navigating to
 * `/app/settings` afterwards is this milestone's one real tenant-scoped
 * screen to demonstrate it against.
 */
@Component({
  selector: 'app-admin-tenants-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-tenants-page.html',
})
export class AdminTenantsPage {
  private readonly adminApi = inject(AdminApiService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);

  readonly tenants = signal<Tenant[]>([]);
  readonly isLoading = signal(true);
  readonly actioningTenantId = signal<string | null>(null);

  readonly impersonatedTenant = this.authState.impersonatedTenant;

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.adminApi.listTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  actAs(tenant: Tenant): void {
    this.authState.setImpersonatedTenant(tenant);
    void this.router.navigateByUrl('/app/settings');
  }

  returnToMyAccount(): void {
    this.authState.setImpersonatedTenant(null);
  }

  suspend(tenant: Tenant): void {
    const reason = prompt(`Reason for suspending ${tenant.name}?`) ?? undefined;
    this.actioningTenantId.set(tenant.id);
    this.adminApi.suspendTenant(tenant.id, reason).subscribe({
      next: (updated) => this.replaceTenant(updated),
      complete: () => this.actioningTenantId.set(null),
    });
  }

  reactivate(tenant: Tenant): void {
    this.actioningTenantId.set(tenant.id);
    this.adminApi.reactivateTenant(tenant.id).subscribe({
      next: (updated) => this.replaceTenant(updated),
      complete: () => this.actioningTenantId.set(null),
    });
  }

  private replaceTenant(updated: Tenant): void {
    this.tenants.update((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }
}
