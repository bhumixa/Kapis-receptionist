import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthStateService } from '../../../../core/auth/auth-state.service';

/**
 * Minimal authenticated landing at `/app/dashboard` — proves login ->
 * session -> guarded route works end to end. Real dashboard content
 * (KPIs, upcoming appointments, handoff queue) is
 * docs/FRONTEND_ARCHITECTURE.md Section 6.1, built out once Appointments/
 * Conversations exist (later milestones).
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-dashboard-page.html',
})
export class AppDashboardPage {
  private readonly authState = inject(AuthStateService);

  readonly currentUser = this.authState.currentUser;
  readonly currentTenant = this.authState.currentTenant;
}
