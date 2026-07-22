import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { PermissionService } from '../../core/auth/permission.service';
import { SessionService } from '../../core/auth/session.service';

/**
 * The authenticated shell, extended in Milestone 3 with real nav (Settings)
 * and tenant-awareness: the tenant name in the header, and — when a
 * `SUPER_ADMIN` is impersonating a tenant (docs/adr/ADR-006) — a persistent
 * "Acting as X" banner with a "Return to my account" escape hatch, so
 * there's never ambiguity about whose data is on screen.
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
  readonly loggingOut = signal(false);

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
