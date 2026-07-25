import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { PermissionService } from '../../core/auth/permission.service';
import { SessionService } from '../../core/auth/session.service';

const TRIAL_WARNING_WINDOW_DAYS = 3;

/**
 * The authenticated shell, extended in Milestone 3 with real nav (Settings)
 * and tenant-awareness: the tenant name in the header, and — when a
 * `SUPER_ADMIN` is impersonating a tenant (docs/adr/ADR-006) — a persistent
 * "Acting as X" banner with a "Return to my account" escape hatch, so
 * there's never ambiguity about whose data is on screen.
 *
 * Milestone 9 (docs/BILLING_ARCHITECTURE.md): adds a "Billing" nav link and
 * a persistent, app-wide subscription-status banner — `PAST_DUE` (payment
 * failed, grace period, escapes this page's own boundaries deliberately per
 * FRONTEND_ARCHITECTURE.md Section 6.8) or a trial nearing expiry — both
 * computed directly from `AuthStateService.currentTenant()` (already
 * populated by `/auth/me`), no extra API call needed.
 */
@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-layout.html',
})
export class DashboardLayout {
  private readonly authState = inject(AuthStateService);
  private readonly sessionService = inject(SessionService);
  private readonly router = inject(Router);
  private readonly permissionService = inject(PermissionService);

  readonly currentUser = this.authState.currentUser;
  readonly currentTenant = this.authState.currentTenant;
  readonly impersonatedTenant = this.authState.impersonatedTenant;
  readonly canViewSettings = this.permissionService.can('settings:manage');
  readonly canViewBilling = this.permissionService.can('billing:manage');
  readonly loggingOut = signal(false);

  readonly billingBanner = computed(() => {
    const tenant = this.currentTenant();
    if (!tenant) {
      return null;
    }
    if (tenant.status === 'PAST_DUE') {
      return {
        tone: 'warning' as const,
        message:
          "We couldn't process your last payment. Update your billing to avoid interruption.",
      };
    }
    if (tenant.status === 'TRIAL' && tenant.trialEndsAt) {
      const daysLeft = Math.ceil(
        (new Date(tenant.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (daysLeft <= TRIAL_WARNING_WINDOW_DAYS) {
        return {
          tone: 'info' as const,
          message:
            daysLeft > 0
              ? `Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`
              : 'Your trial has ended.',
        };
      }
    }
    return null;
  });

  returnToMyAccount(): void {
    this.authState.setImpersonatedTenant(null);
    void this.router.navigateByUrl('/admin/tenants');
  }

  logout(): void {
    this.loggingOut.set(true);
    this.sessionService.logout().subscribe({
      complete: () => {
        this.loggingOut.set(false);
        void this.router.navigate(['/auth/login']);
      },
      error: () => {
        // Session is cleared client-side by SessionService.logout()'s
        // `finalize` regardless of the HTTP outcome (API_SPECIFICATION.md
        // Section 4: revoking an already-revoked/unreachable session is
        // still a safe local sign-out) — still navigate away.
        this.loggingOut.set(false);
        void this.router.navigate(['/auth/login']);
      },
    });
  }
}
