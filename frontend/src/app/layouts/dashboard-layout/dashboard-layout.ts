import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { SessionService } from '../../core/auth/session.service';

/**
 * Minimal authenticated shell — proves the session flow end to end
 * (header identity + logout). The full sidebar/topbar chrome
 * (docs/FRONTEND_ARCHITECTURE.md Section 4.2) is built out feature by
 * feature starting Milestone 3, once there are real nav destinations.
 */
@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-layout.html',
})
export class DashboardLayout {
  private readonly authState = inject(AuthStateService);
  private readonly sessionService = inject(SessionService);
  private readonly router = inject(Router);

  readonly currentUser = this.authState.currentUser;
  readonly currentTenant = this.authState.currentTenant;
  readonly loggingOut = signal(false);

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
