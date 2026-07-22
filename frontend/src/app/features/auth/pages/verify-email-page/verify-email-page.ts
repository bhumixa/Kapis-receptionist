import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthApiService } from '../../../../core/auth/auth-api.service';

type VerifyState = 'verifying' | 'success' | 'error';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 5.4 — no form; reads `:token` from
 * the route on load, immediately calls `POST /auth/verify-email`. Reachable
 * whether or not the user currently has an active session (no guard), since
 * the link is delivered via email and may be opened on a different
 * device/browser than the one currently logged in.
 */
@Component({
  selector: 'app-verify-email-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './verify-email-page.html',
})
export class VerifyEmailPage {
  private readonly authApi = inject(AuthApiService);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<VerifyState>('verifying');

  constructor() {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.state.set('error');
      return;
    }

    this.authApi.verifyEmail(token).subscribe({
      next: () => this.state.set('success'),
      error: () => this.state.set('error'),
    });
  }
}
