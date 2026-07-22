import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { SessionService } from '../../core/auth/session.service';

/**
 * Structurally similar to `DashboardLayout` but visually distinct (a
 * persistent "Platform Admin" badge) — FRONTEND_ARCHITECTURE.md Section 4.3's
 * explicit requirement that a Super Admin never mistake this console for a
 * tenant's own dashboard. Reachable only via `/admin/*`, itself
 * `SUPER_ADMIN`-gated by `roleGuard` at the route level.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  private readonly authState = inject(AuthStateService);
  private readonly sessionService = inject(SessionService);
  private readonly router = inject(Router);

  readonly currentUser = this.authState.currentUser;
  readonly loggingOut = signal(false);

  logout(): void {
    this.loggingOut.set(true);
    this.sessionService.logout().subscribe({
      complete: () => void this.router.navigate(['/auth/login']),
      error: () => void this.router.navigate(['/auth/login']),
    });
  }
}
